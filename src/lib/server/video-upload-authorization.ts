import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedVideo } from '@/lib/cloudflare/r2'
import { checkRateLimit } from '@/lib/rate-limit'
import { uploadCapsForTier, tooLargeMessage, STUDIO_VIDEO_BYTES } from '@/lib/media'
import { getUserTierById } from '@/lib/subscriptions'
import { resolveMaxDurationSeconds } from '@/lib/stream-duration'
import { reportServerError } from '@/lib/report-server-error'
import { videoCaps, videoBudgetExceeded, videoAlbumFullMessage, albumEffectiveTier } from '@/lib/album-entitlements'
import { gateAllowsContribution, signedInUserForGate, ALBUM_GATE_COLS } from '@/lib/server/album-access'
import type { Tier } from '@/types'

// EVERYTHING THAT DECIDES WHETHER A VIDEO MAY BE UPLOADED, in a place a test can reach it.
//
// This lived inline in /api/upload/stream, and an adversarial review showed what that cost: five
// separate mutations to that route survived the entire 901-test suite. The whole budget check
// replaced with `if (false)` — every video uploads, no limit at all — green. The Cloudflare
// reservation hardcoded to 60 seconds, so every video over a minute uploads completely over venue
// wifi and then dies at 100% during processing, this repo's worst-recorded video bug — green.
//
// The pure functions it calls score 12 of 12 against the same mutations. They were never the
// problem. Rule 15: the decision had been extracted and tested while the ENFORCEMENT stayed in a
// route handler where nothing could observe it, which is the identical shape as the tus
// missing-Content-Length fix that sat dead for three commits.
//
// THIS ROUTE IS THE ONLY PLACE VIDEO COST IS BOUNDED. /api/album/photos/create writes
// duration_seconds and checks no budget whatsoever, so there is no second line of defence behind
// this one. Cloudflare Stream bills per MINUTE STORED every month regardless of bytes, and the
// account's storage is a PURCHASED CEILING — exceeding it does not cost more, it makes every video
// upload fail for every album at once.
//
// Mirrors src/lib/server/image-upload-authorization.ts deliberately: same
// `{ ok: true, … } | { ok: false; response }` shape, same NextResponse construction inside the
// module, so the two upload paths can never drift on how a refusal is shaped.

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_VIDEO_HARD_CAP = STUDIO_VIDEO_BYTES // absolute ceiling = studio tier cap

export type VideoUploadAuthResult =
  | {
      ok: true
      /** The ALBUM's effective tier — the owner's plan or its package, whichever is better. */
      effectiveTier: Tier
      /**
       * What Cloudflare is told to reserve. Returned rather than recomputed by the caller, because
       * it is ENFORCEMENT and has to travel with the decision that approved the clip (rule 15).
       * Hardcoding this at the call site was a mutation that survived every test.
       */
      maxDurationSeconds: number
    }
  | { ok: false; response: Response }

/**
 * Everything between "the request is well-formed" and "ask Cloudflare for an upload URL".
 *
 * The caller still owns CSRF, the per-IP limit and body-field validation, exactly as the image path
 * does — those need no album and no database, and keeping them at the edge means a malformed
 * request never reaches a query.
 *
 * ORDER IS PART OF THE CONTRACT and is unchanged from the inline version: type, hard cap, album,
 * uploads-enabled, gate, per-album limit, tier, per-tier size cap, budget. A guest refused for the
 * wrong reason gets a message they cannot act on.
 */
export async function authorizeVideoUpload(
  params: { albumId: string; contentType: string; fileSize: number; durationSeconds: unknown },
): Promise<VideoUploadAuthResult> {
  const normalizedType = params.contentType.toLowerCase()
  if (!isAllowedVideo(normalizedType)) {
    return { ok: false, response: NextResponse.json({ error: 'File type not allowed' }, { status: 415, headers: NO_STORE }) }
  }

  if (params.fileSize > MAX_VIDEO_HARD_CAP) {
    // The absolute ceiling, above every tier. Phrased through the shared helper so it is the one
    // refusal on this path that leaves somebody something to do about it.
    return {
      ok: false,
      response: NextResponse.json(
        { error: tooLargeMessage('video', MAX_VIDEO_HARD_CAP) },
        { status: 413, headers: NO_STORE },
      ),
    }
  }

  const admin = createAdminClient()
  const { data: album, error: albumError } = await admin
    .from('albums')
    .select(`id, user_id, guest_uploads_enabled, package_tier, package_expires_at, ${ALBUM_GATE_COLS}`)
    .eq('id', params.albumId)
    .is('retired_at', null)
    .maybeSingle<{
      id: string; user_id: string | null; guest_uploads_enabled: boolean
      package_tier: 'pro' | 'studio' | null; package_expires_at: string | null
      owner_token: string; password_hash: string | null; reveal_at: string | null
    }>()

  if (albumError || !album) {
    return { ok: false, response: NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE }) }
  }
  if (!album.guest_uploads_enabled) {
    return { ok: false, response: NextResponse.json({ error: 'Uploads disabled for this album' }, { status: 403, headers: NO_STORE }) }
  }

  // A password or reveal gate applies to contributing, not just to viewing — same check the image
  // path and the photo listing use, so all three can never disagree about who may add to an album.
  const gate = await gateAllowsContribution(album, await cookies(), await signedInUserForGate(album))
  if (!gate.ok) {
    return { ok: false, response: NextResponse.json({ error: gate.error }, { status: 403, headers: NO_STORE }) }
  }

  // Rate-limit BEFORE the subscription lookup — reject hammered albums without paying the tier cost.
  const albumRl = await checkRateLimit(`stream_album:${params.albumId}`, 3600, 4000, { failOpen: false })
  if (!albumRl.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Album video upload rate limit reached' },
        { status: 429, headers: { 'Retry-After': String(albumRl.retryAfterSeconds), ...NO_STORE } },
      ),
    }
  }

  let tier: Awaited<ReturnType<typeof getUserTierById>>
  try {
    tier = await getUserTierById(album.user_id)
  } catch (e) {
    console.error('[stream] getUserTierById failed:', e instanceof Error ? e.message : String(e))
    reportServerError('stream', 'Service temporarily unavailable (503)')
    return { ok: false, response: NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503, headers: NO_STORE }) }
  }

  // The ALBUM's tier, not just its owner's — a package raises both the file-size cap and the video
  // budget below, or a Max Package album would refuse the 4 GB uploads it was sold with.
  const effectiveTier = albumEffectiveTier(album.user_id ? tier : null, {
    tier: album.package_tier, expiresAt: album.package_expires_at,
  })
  const caps = uploadCapsForTier(effectiveTier)
  if (params.fileSize > caps.video) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: tooLargeMessage('video', caps.video) },
        { status: 413, headers: NO_STORE },
      ),
    }
  }

  // ── THE ALBUM'S MINUTE POOL, WHICH IS THE ONLY VIDEO LIMIT ──────────────────
  //
  // A file SIZE cap does not bound video cost: Stream bills per minute stored, and a
  // well-compressed 200 MB file can be half an hour.
  const vcaps = videoCaps(effectiveTier)

  // Summed, not counted: the budget is minutes, so minutes are what has to be measured.
  //
  // THE media_type FILTER IS LOAD-BEARING, and only because of the limit beneath it. Photo rows
  // have a NULL duration, so dropping the filter does not change the arithmetic — it changes WHICH
  // thousand rows come back. On an album past 1,000 items the thousand returned would be
  // overwhelmingly photos, the sum would read 0, and the video budget would stop being enforced
  // entirely, silently, on exactly the largest albums. A database-side sum() is the permanent fix
  // and is tracked separately; until then this filter is what keeps the limit real.
  //
  // The read happens once and the insert happens later, so simultaneous uploads can overshoot by
  // roughly what is in flight — the same bounded overshoot the item cap accepts.
  const { data: durations, error: videoSumErr } = await admin
    .from('photos')
    .select('duration_seconds')
    .eq('album_id', params.albumId)
    .eq('media_type', 'video')
    .limit(1000)
    .returns<{ duration_seconds: number | null }[]>()

  if (videoSumErr) {
    // Fails OPEN, in the same direction as every other counted limit here: a total we could not
    // read does not block the upload. Letting a few extra minutes through during a database blip is
    // far cheaper than refusing every guest at a live event — but a budget that has silently
    // stopped being enforced belongs in the panel, not only in a log nobody reads.
    console.error('[stream] video budget NOT enforced — sum failed for album', params.albumId, ':', videoSumErr.message)
    reportServerError('stream', 'Video budget NOT enforced — the duration query failed', {
      albumId: params.albumId,
      context: { reason: videoSumErr.message.slice(0, 200) },
    })
  } else {
    const usedSeconds = (durations ?? []).reduce((total, row) => total + (row.duration_seconds ?? 0), 0)
    if (videoBudgetExceeded(usedSeconds, params.durationSeconds, vcaps)) {
      // 403, NOT 429. lib/upload-policy treats 429 as retryable and runs the whole route four more
      // times behind a backoff — for a refusal that is permanent until somebody deletes something.
      return {
        ok: false,
        response: NextResponse.json(
          { code: 'album_video_full', error: videoAlbumFullMessage(vcaps, usedSeconds) },
          { status: 403, headers: NO_STORE },
        ),
      }
    }
  }

  return {
    ok: true,
    effectiveTier,
    // NEVER clamped to the budget or to any cap. Cloudflare does not refuse an upload longer than
    // this — it accepts the bytes and fails during PROCESSING, so a value even slightly too small
    // means a guest uploads their whole video and watches it die at 100%. See lib/stream-duration.
    maxDurationSeconds: resolveMaxDurationSeconds(params.durationSeconds),
  }
}
