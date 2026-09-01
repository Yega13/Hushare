import { NextResponse } from 'next/server'
import { reportServerError } from '@/lib/report-server-error'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedVideo } from '@/lib/cloudflare/r2'
import { createStreamUpload } from '@/lib/cloudflare/stream'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { uploadCapsForTier, tooLargeMessage, STUDIO_VIDEO_BYTES } from '@/lib/media'
import { getUserTierById } from '@/lib/subscriptions'
import { resolveMaxDurationSeconds } from '@/lib/stream-duration'
import {
  videoCaps, clipTooLong, videoBudgetExceeded, videoTooLongMessage, videoAlbumFullMessage,
  albumEffectiveTier,
} from '@/lib/album-entitlements'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { gateAllowsContribution, signedInUserForGate, ALBUM_GATE_COLS } from '@/lib/server/album-access'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_VIDEO_HARD_CAP = STUDIO_VIDEO_BYTES // absolute ceiling = studio tier cap

type Body = {
  albumId?: unknown
  fileName?: unknown
  contentType?: unknown
  fileSize?: unknown
  durationSeconds?: unknown
}

// Cloudflare reserves maxDurationSeconds of STORAGE QUOTA for every pending (incomplete) upload,
// so this must be kept TIGHT — not a blanket 6h ceiling. A fixed 21600 (6h) made each incomplete
// or abandoned upload reserve 360 min; a handful of them exhausted the whole account's 1000-min
// quota and blocked ALL video uploads. Use the client-measured duration plus a safety margin
// (Cloudflare rejects a video LONGER than maxDurationSeconds, so the margin absorbs measurement
// error), and fall back to 2h only when the client couldn't measure the duration.
export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  // Per-IP, but a venue is ONE IP — every guest in the room shares this counter.
  //
  // 200/hr blocked a crowd outright. 2400/hr was sized for "a busy event", but a 300-guest wedding
  // posting 8 videos each is 2400 exactly: the limit sits precisely at the expected load, so the
  // room hits it near the end of the night and the last guests are refused with nothing wrong.
  // A limit you are meant to reach is not a safety limit, it is a bug with a 429.
  //
  // 10000 keeps it an abuse backstop rather than a participation cap. The real cost guards are
  // unchanged and are the ones that should bind: Cloudflare Stream's storage quota, the per-album
  // media cap below, and the per-tier file-size cap. Note this counter is itself a row-per-call in
  // Postgres (see lib/rate-limit.ts) — the durable fix is the Cloudflare rate-limit binding already
  // configured in wrangler.toml, which is scheduled for after the August events.
  const ipRl = await checkRateLimit(clientIpKey(req, 'stream_ip'), 3600, 10000, { failOpen: false })
  if (!ipRl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(ipRl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const body = await req.json().catch(() => null) as Body | null
  const { albumId, fileName, contentType, fileSize, durationSeconds } = body ?? {}

  if (
    typeof albumId !== 'string' || !UUID_RE.test(albumId) ||
    typeof fileName !== 'string' || !fileName || fileName.length > 255 ||
    typeof contentType !== 'string' || !contentType ||
    typeof fileSize !== 'number' || !Number.isFinite(fileSize) || !Number.isInteger(fileSize) || fileSize <= 0
  ) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400, headers: NO_STORE })
  }

  const normalizedType = contentType.toLowerCase()
  if (!isAllowedVideo(normalizedType)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 415, headers: NO_STORE })
  }

  if (fileSize > MAX_VIDEO_HARD_CAP) {
    // The absolute ceiling, above every tier. It said only 'File too large' because it predates
    // the shared helper -- the one refusal on the whole path that still left someone with nothing
    // to do about it. Nobody has reached it yet; that is not a reason to leave it rude.
    return NextResponse.json(
      { error: tooLargeMessage('video', MAX_VIDEO_HARD_CAP) },
      { status: 413, headers: NO_STORE },
    )
  }

  const admin = createAdminClient()
  const { data: album, error: albumError } = await admin
    .from('albums')
    .select(`id, user_id, guest_uploads_enabled, package_tier, package_expires_at, ${ALBUM_GATE_COLS}`)
    .eq('id', albumId)
    .is('retired_at', null)
    .maybeSingle<{
      id: string; user_id: string | null; guest_uploads_enabled: boolean
      package_tier: 'pro' | 'studio' | null; package_expires_at: string | null
      owner_token: string; password_hash: string | null; reveal_at: string | null
    }>()

  if (albumError || !album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (!album.guest_uploads_enabled) {
    return NextResponse.json({ error: 'Uploads disabled for this album' }, { status: 403, headers: NO_STORE })
  }

  // A password or reveal gate applies to contributing, not just to viewing — same check the image
  // path and the photo listing use, so all three can never disagree about who may add to an album.
  const gate = await gateAllowsContribution(album, await cookies(), await signedInUserForGate(album))
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: 403, headers: NO_STORE })
  }

  // Rate-limit BEFORE subscription lookup — reject hammered albums without paying the tier cost
  const albumRl = await checkRateLimit(`stream_album:${albumId}`, 3600, 4000, { failOpen: false })
  if (!albumRl.ok) {
    return NextResponse.json(
      { error: 'Album video upload rate limit reached' },
      { status: 429, headers: { 'Retry-After': String(albumRl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  let tier: Awaited<ReturnType<typeof getUserTierById>>
  try {
    tier = await getUserTierById(album.user_id)
  } catch (e) {
    console.error('[stream] getUserTierById failed:', e instanceof Error ? e.message : String(e))
    reportServerError('stream', 'Service temporarily unavailable (503)')
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503, headers: NO_STORE })
  }

  // The ALBUM's tier, not just its owner's — a package raises both the file-size caps and the
  // video budget below, or a Max Package album would refuse the 4 GB uploads it was sold with.
  const effective = albumEffectiveTier(album.user_id ? tier : null, {
    tier: album.package_tier, expiresAt: album.package_expires_at,
  })
  const caps = uploadCapsForTier(effective)
  if (fileSize > caps.video) {
    return NextResponse.json(
      { error: tooLargeMessage('video', caps.video) },
      { status: 413, headers: NO_STORE },
    )
  }

  // ── HOW LONG, AND HOW MANY ──────────────────────────────────────────────────
  //
  // Neither was limited before this. A file SIZE cap does not bound video cost, because Cloudflare
  // Stream bills per MINUTE stored every month (and again per minute watched) regardless of how
  // many bytes those minutes take. A well-compressed 200 MB file can be half an hour.
  const vcaps = videoCaps(effective)

  if (clipTooLong(durationSeconds, vcaps)) {
    return NextResponse.json(
      { code: 'video_too_long', error: videoTooLongMessage(vcaps) },
      { status: 413, headers: NO_STORE },
    )
  }

  // HOW MUCH VIDEO TIME THIS ALBUM HAS ALREADY SPENT.
  //
  // Summed, not counted: the budget is minutes, so minutes are what has to be measured. The rows
  // are small (durations only) and video is 1.4% of everything uploaded, so this reads a handful
  // of numbers even on the busiest album.
  //
  // The read happens once and the insert happens later, so simultaneous uploads can overshoot by
  // roughly what is in flight — the same bounded overshoot the item cap accepts, and the reason
  // the budget is not the last word on cost. Enforcing it exactly needs a database constraint,
  // which costs an outage risk on the upload path; the overshoot costs pennies.
  const { data: durations, error: videoSumErr } = await admin
    .from('photos')
    .select('duration_seconds')
    .eq('album_id', albumId)
    .eq('media_type', 'video')
    .limit(1000)
    .returns<{ duration_seconds: number | null }[]>()

  if (videoSumErr) {
    // Fails open, in the same direction as every other counted limit here: a total we could not
    // read does not block the upload. Letting a few extra minutes through during a database blip
    // is far cheaper than refusing every guest at a live event — but a budget that has silently
    // stopped being enforced belongs in the panel, not only in a log nobody reads.
    console.error('[stream] video budget NOT enforced — sum failed for album', albumId, ':', videoSumErr.message)
    reportServerError('stream', 'Video budget NOT enforced — the duration query failed', {
      albumId,
      context: { reason: videoSumErr.message.slice(0, 200) },
    })
  } else {
    const usedSeconds = (durations ?? []).reduce((total, row) => total + (row.duration_seconds ?? 0), 0)
    if (videoBudgetExceeded(usedSeconds, durationSeconds, vcaps)) {
      // 403, NOT 429. lib/upload-policy treats 429 as retryable and runs the whole route four more
      // times behind a backoff — for a refusal that is permanent until somebody deletes something.
      return NextResponse.json(
        { code: 'album_video_full', error: videoAlbumFullMessage(vcaps, usedSeconds) },
        { status: 403, headers: NO_STORE },
      )
    }
  }

  let uploadUrl: string
  let streamUid: string
  let iframeUrl: string
  let thumbnailUrl: string
  try {
    // Sanitize fileName to printable ASCII before passing to Cloudflare Stream's metadata API.
    const safeName = String(fileName).replace(/[^\w.\- ]/g, '_').slice(0, 255)
    const maxDurationSeconds = resolveMaxDurationSeconds(durationSeconds)
    ;({ uploadUrl, streamUid, iframeUrl, thumbnailUrl } = await createStreamUpload(fileSize, safeName, maxDurationSeconds))
  } catch (e) {
    console.error('[stream] createStreamUpload failed:', e instanceof Error ? e.message : String(e))
    reportServerError('stream', 'Failed to initiate video upload (502)')
    return NextResponse.json({ error: 'Failed to initiate video upload' }, { status: 502, headers: NO_STORE })
  }

  // Guard against a compromised or misconfigured Cloudflare API returning a
  // non-Cloudflare upload URL that would be forwarded to the client. Cloudflare
  // returns either upload.videodelivery.net (legacy) or upload.cloudflarestream.com.
  if (
    !uploadUrl.startsWith('https://upload.videodelivery.net/') &&
    !uploadUrl.startsWith('https://upload.cloudflarestream.com/')
  ) {
    console.error('[stream] Cloudflare returned unexpected uploadUrl origin:', uploadUrl.slice(0, 80))
    reportServerError('stream', 'Failed to initiate video upload (502)')
    return NextResponse.json({ error: 'Failed to initiate video upload' }, { status: 502, headers: NO_STORE })
  }

  // Bind stream_uid → albumId before returning to client.
  // photos/create verifies and consumes this row — prevents a guest from calling
  // /upload/stream for album A then injecting that uid into album B via photos/create.
  // upload_url is the exact Cloudflare `Location` header from createStreamUpload — stored so the
  // stream-relay fallback (src/app/api/upload/stream-relay/[uid]/route.ts) can forward to the real
  // URL without ever reconstructing/guessing Cloudflare's URL format from just the uid.
  const { error: pendingErr } = await admin
    .from('pending_stream_uploads')
    .insert({ stream_uid: streamUid, album_id: albumId, upload_url: uploadUrl })
  if (pendingErr) {
    console.error('[stream] pending_stream_uploads insert failed:', pendingErr.message)
    reportServerError('stream', 'Failed to initiate video upload (502)')
    return NextResponse.json({ error: 'Failed to initiate video upload' }, { status: 502, headers: NO_STORE })
  }

  // Stale rows (video uploaded but photos/create never called, e.g. tab closed) are pruned by
  // api/cron/prune-data on the daily pass. There used to be a `Math.random() < 0.01` sweep here
  // instead, and it did not work: it only ran when somebody started ANOTHER video upload, video is
  // 1.5% of media, so six-week-old rows were still sitting there — each one a redeemable upload
  // token past its 24-hour life. Cleanup that only runs when there is something to clean up after
  // cannot keep a promise, and having it here made it look covered.

  return NextResponse.json({ uploadUrl, streamUid, iframeUrl, thumbnailUrl }, { headers: NO_STORE })
}
