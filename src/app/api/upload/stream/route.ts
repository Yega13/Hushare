import { NextResponse } from 'next/server'
import { reportServerError } from '@/lib/report-server-error'
import { createAdminClient } from '@/lib/supabase/admin'
import { createStreamUpload } from '@/lib/cloudflare/stream'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { authorizeVideoUpload } from '@/lib/server/video-upload-authorization'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  // EVERY AUTHORIZATION DECISION LIVES IN ONE TESTED MODULE NOW.
  //
  // It was inline here, and five mutations to it survived all 901 tests — including replacing the
  // whole budget check with `if (false)`, and hardcoding the Cloudflare reservation to 60 seconds.
  // The pure functions scored 12/12 against the same mutations; the enforcement around them was
  // covered by nothing (rule 15). See lib/server/video-upload-authorization.ts.
  const auth = await authorizeVideoUpload({ albumId, contentType, fileSize, durationSeconds })
  if (!auth.ok) return auth.response

  const admin = createAdminClient()

  let uploadUrl: string
  let streamUid: string
  let iframeUrl: string
  let thumbnailUrl: string
  try {
    // Sanitize fileName to printable ASCII before passing to Cloudflare Stream's metadata API.
    const safeName = String(fileName).replace(/[^\w.\- ]/g, '_').slice(0, 255)
    // auth.maxDurationSeconds, never recomputed here: hardcoding this value was a mutation that
    // survived every test, and it is the one that kills uploads at 100% during processing.
    ;({ uploadUrl, streamUid, iframeUrl, thumbnailUrl } = await createStreamUpload(fileSize, safeName, auth.maxDurationSeconds))
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
  // THE DURATION WE JUST CHECKED, WRITTEN DOWN.
  //
  // photos/create used to take the client's word a SECOND time, from a different request, and that
  // second number is what the album was billed for. Declaring one second here bought a 62-second
  // Cloudflare reservation, so a real 62-second video uploaded fine while the album's total rose by
  // one — repeatable to the item cap, against a purchased Stream ceiling shared by every album.
  //
  // Recording it here makes the checked number and the charged number the same number. Clamped and
  // rounded to match the column; null when the browser could not measure the clip, which is ~16% of
  // real videos and must keep working.
  const declaredDurationSeconds =
    typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.max(0, Math.round(durationSeconds))
      : null

  const { error: pendingErr } = await admin
    .from('pending_stream_uploads')
    .insert({
      stream_uid: streamUid,
      album_id: albumId,
      upload_url: uploadUrl,
      declared_duration_seconds: declaredDurationSeconds,
    })
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
