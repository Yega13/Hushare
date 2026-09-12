import { NextResponse } from 'next/server'
import { asPackageTier } from '@/lib/db-unions'
import { cookies } from 'next/headers'
import { v4 as uuid } from 'uuid'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedImage, safeExtForMime } from '@/lib/cloudflare/r2'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { presignBudget } from '@/lib/presign-budget'
import { uploadCapsForTier, tooLargeMessage } from '@/lib/media'
import { albumCap as albumCapFor, albumEffectiveTier, albumFullRefusal } from '@/lib/album-entitlements'
import { getUserTierResolved } from '@/lib/subscriptions'
import { reportServerError } from '@/lib/report-server-error'
import { gateAllowsContribution, signedInUserForGate, ALBUM_GATE_COLS } from '@/lib/server/album-access'
import type { Tier } from '@/types'

// Shared authorization logic for the image upload path — the SINGLE source of truth used by both
// /api/upload/presign (the normal direct-to-R2 path) and /api/upload/image-relay (the fallback for
// networks that block R2's upload domain). Keeping this in one place guarantees the two routes can
// never drift apart on what's allowed, mirroring the pattern already used this session for
// src/lib/server/album-access.ts during the album-page SSR work, for exactly the same reason.

const NO_STORE = { 'Cache-Control': 'no-store' }
// Client thumbnails are ~20–80KB JPEGs; kept here only for the presign route's paired-thumb size
// validation — the relay route never handles a paired thumb (see deriveImageKey below).
/**
 * The absolute ceiling, above every tier — DERIVED, because it was a second copy of a number that
 * already exists.
 *
 * It was `200 * 1024 * 1024` with a comment calling it an independent safety net. It is not:
 * PRO_IMAGE_BYTES, the highest image cap any tier gets, is also exactly 200 MB. So the check could
 * never bind — anything the per-tier cap allows is already at or under it — and a mutation deleting
 * it entirely changed no behaviour at all, which is how this was found.
 *
 * They agreed by coincidence, and the two ways that coincidence ends are both silent: raise
 * PRO_IMAGE_BYTES and this starts refusing uploads a paying customer was sold, or lower it and this
 * becomes dead weight nobody notices. Derived from the same source, they cannot part company.
 *
 * The check stays rather than being deleted: it runs BEFORE the album lookup, so a hostile
 * multi-gigabyte declaration is refused without costing a database round trip, which the per-tier
 * cap several steps later cannot do.
 */
const MAX_FILESIZE_HARD_CAP = uploadCapsForTier('studio').image

export type ImageUploadAuthResult =
  | { ok: true; tier: Tier; imageCap: number }
  | { ok: false; response: Response }

// Re-runs the EXACT validation /api/upload/presign already performed: file type allowed, absolute
// size ceiling, per-IP rate limit ∥ album lookup (exists, not retired, guest_uploads_enabled),
// per-album rate limit ∥ tier lookup, and the tier's image size cap. Does NOT touch storage —
// callers derive a key separately via deriveImageKey() once authorized.
export async function authorizeImageUpload(
  req: Request,
  // fileSize null = the caller could not learn it (Chrome on iOS omits Content-Length). Treated as
  // "as large as this album may legally accept": the byte cap is then enforced on the ACTUAL bytes
  // by the relay's size-limit stream, which is the only measurement that was ever authoritative.
  params: { albumId: string; contentType: string; fileSize: number | null },
): Promise<ImageUploadAuthResult> {
  // Not lowercased first: isAllowedImage does that itself, and a second normalisation in front of
  // it cannot change an answer. It was here, it looked like the case-insensitivity guard, and
  // deleting it changed no test -- which is the shape that makes a real guard look optional.
  if (!isAllowedImage(params.contentType)) {
    return { ok: false, response: NextResponse.json({ error: 'File type not allowed' }, { status: 415, headers: NO_STORE }) }
  }
  if (params.fileSize !== null && params.fileSize > MAX_FILESIZE_HARD_CAP) {
    return { ok: false, response: NextResponse.json({ error: 'File too large' }, { status: 413, headers: NO_STORE }) }
  }

  const admin = createAdminClient()

  // The IP rate limit and the album lookup are independent — run them in parallel and check the
  // limiter's verdict first (same ordering/reasoning as the original presign route).
  const [ipRl, albumRes] = await Promise.all([
    checkRateLimit(clientIpKey(req, 'presign_ip'), 3600, 12000, { failOpen: false }),
    admin
      .from('albums')
      .select(`id, user_id, guest_uploads_enabled, media_cap_override, created_at, package_tier, package_expires_at, ${ALBUM_GATE_COLS}`)
      .eq('id', params.albumId)
      .is('retired_at', null)
      .maybeSingle(),
  ])
  if (!ipRl.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(ipRl.retryAfterSeconds), ...NO_STORE } },
      ),
    }
  }
  const album = albumRes.data
  if (albumRes.error || !album) {
    return { ok: false, response: NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE }) }
  }
  if (!album.guest_uploads_enabled) {
    return { ok: false, response: NextResponse.json({ error: 'Uploads disabled for this album' }, { status: 403, headers: NO_STORE }) }
  }

  // A password or reveal gate applies to contributing, not just to viewing — see
  // gateAllowsContribution, which the photo listing's own gate sits beside.
  const gate = await gateAllowsContribution(album, await cookies(), await signedInUserForGate(album))
  if (!gate.ok) {
    return { ok: false, response: NextResponse.json({ error: gate.error }, { status: 403, headers: NO_STORE }) }
  }

  // THE PER-ALBUM CEILING IS SIZED TO WHAT THE ALBUM COULD STILL LEGITIMATELY HOLD.
  //
  // It was a flat 40,000/hour, which at the free-tier file size is roughly a terabyte an hour of
  // permanent storage for anyone who knows one album id. The media cap cannot bound this: the cap
  // counts ROWS, and an abuser never creates one — they take the slot, PUT the bytes and never
  // call photos/create. Nothing then references those objects, every deletion path works from
  // rows, and the storage audit deletes nothing, so both the bytes and the bill are forever.
  //
  // The count runs alongside the tier lookup rather than after it, so this costs no extra latency
  // on the upload path. lib/presign-budget.ts owns the arithmetic and errs open on a failed count.
  const [tierRes, countRes] = await Promise.all([
    // AUTHORITATIVE, not merely a tier. getUserTierById degrades a failed subscriptions query to
    // 'free' (lib/subscriptions logs the error and refuses to cache the answer), which is right for
    // display and wrong for a refusal: a Max album holding 600 of its 10,000 would be called full at
    // the free cap of 500, and told to upgrade the plan it already pays for.
    getUserTierResolved(album.user_id)
      .then(r => ({ tier: r.tier as Tier | null, authoritative: r.authoritative, error: null as unknown }))
      .catch((error: unknown) => ({ tier: null as Tier | null, authoritative: false, error })),
    admin.from('photos').select('id', { count: 'exact', head: true }).eq('album_id', params.albumId),
  ])
  // ONE answer to "how many items may this album hold" — shared with photos/create, which
  // enforces the same number as a hard block. This used to read `override ?? tierCap`, with no
  // grandfathering at all, so an old album's presign budget was computed from a smaller cap than
  // the one actually enforced a moment later.
  //
  // A failed tier lookup is treated as 'free' HERE ON PURPOSE: this value only sizes a rate-limit
  // budget, and the request is refused a few lines below when the tier is unknown. Sizing it small
  // is the safe direction; the refusal is what actually protects the album.
  const capInput = {
    // `album.user_id ? ... : null` matters: getUserTierResolved(null) answers 'free' rather than
    // throwing, so passing the tier straight through told albumCap that an ANONYMOUS album was a
    // free-account album — 500 instead of 250, or 1,000 once the free grandfathering applied.
    // Every anonymous album alive today predates that date, so it doubled the hourly presign
    // budget for all of them: ~100 GB/hour of R2 writes that no database row will ever reference
    // and no audit can reconcile. The bytes are permanent; see lib/presign-budget.
    ownerTier: album.user_id ? (tierRes.tier ?? 'free') : null,
    createdAt: album.created_at,
    override: album.media_cap_override,
    pkg: { tier: asPackageTier(album.package_tier), expiresAt: album.package_expires_at },
  }
  const { cap: albumCap } = albumCapFor(capInput)

  // A FULL ALBUM IS REFUSED HERE, AS FULL, and is not handed a slot it cannot use.
  //
  // Measured 2026-09-07 and 2026-09-08: two owners filled their albums and kept uploading. Every
  // photo after that still got a slot here, sent its bytes to R2, and was refused one step later at
  // photos/create -- an object no row will ever reference, the exact permanent-bytes problem the
  // budget below exists to bound. Once 300 of those had gone through in an hour the budget refused
  // the rest as "Album upload rate limit reached": the wrong words, filed as an error, and the owner
  // never saw the upgrade the real refusal carries.
  //
  // 403, NOT 429 -- the same choice video-upload-authorization made and wrote down. lib/upload-policy
  // treats a 429 as retryable, so this whole route would run four more times behind a backoff for a
  // refusal that stands until somebody deletes something: four per-IP limiter slots (one venue is one
  // IP), four album reads, four tier lookups and four count(*) scans, per photo.
  //
  // Only on an AUTHORITATIVE tier and a KNOWN count. Both uncertain branches ALLOW (rule 19): the cap
  // bounds cost, the presign budget still bounds bytes, and photos/create still enforces the cap when
  // the tier is known -- whereas refusing on a guess costs a paying customer the album they bought.
  const full = !countRes.error && countRes.count !== null && countRes.count >= albumCap
  if (full && tierRes.authoritative) {
    return { ok: false, response: NextResponse.json(albumFullRefusal(capInput), { status: 403, headers: NO_STORE }) }
  }
  if (full) {
    // The album looks full, but the tier that sized that cap was a guess, so nothing is enforced
    // here. Same direction as the failed count, and reported for the same reason the video budget
    // reports its own: a cap that has silently stopped being enforced belongs in the panel.
    console.error('[image-upload-auth] media cap NOT enforced — the tier lookup degraded for album', params.albumId)
    reportServerError('image-upload-auth', 'Media cap NOT enforced — the tier lookup degraded', {
      albumId: params.albumId,
      context: { items: countRes.count, capFromGuessedTier: albumCap },
    })
  }

  const albumRl = await checkRateLimit(
    `presign_album:${params.albumId}`,
    3600,
    presignBudget(countRes.error ? null : countRes.count, albumCap),
    { failOpen: false },
  )
  if (!albumRl.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Album upload rate limit reached' },
        { status: 429, headers: { 'Retry-After': String(albumRl.retryAfterSeconds), ...NO_STORE } },
      ),
    }
  }
  if (tierRes.tier === null) {
    console.error('[image-upload-auth] getUserTierResolved failed:', tierRes.error instanceof Error ? tierRes.error.message : String(tierRes.error))
    return { ok: false, response: NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503, headers: NO_STORE }) }
  }

  const caps = uploadCapsForTier(albumEffectiveTier(album.user_id ? tierRes.tier : null, {
    tier: asPackageTier(album.package_tier), expiresAt: album.package_expires_at,
  }))
  if (params.fileSize !== null && params.fileSize > caps.image) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: tooLargeMessage('image', caps.image) },
        { status: 413, headers: NO_STORE },
      ),
    }
  }

  // imageCap rides along because the caller sometimes cannot check it here. When Content-Length is
  // absent the size is unknown at this point, so both gates above are skipped and the relay must
  // re-apply this exact number once it has measured the body itself. Returning it is what keeps
  // that one fact in one place — the relay must never re-derive the album's cap for itself.
  return { ok: true, tier: tierRes.tier, imageCap: caps.image }
}

// Pure key derivation — no I/O. Always server-generated (uuid()); the client never supplies or
// influences the storage key, which is the entire SSRF/cross-album-injection defense for both
// callers (there's nothing to allowlist because there's nothing client-controlled to allow).
export function deriveImageKey(
  albumId: string,
  contentType: string,
  fileName: string,
  isThumb: boolean,
): { key: string; finalContentType: string } {
  const normalizedType = contentType.toLowerCase()
  const rawExt = fileName.split('.').pop()?.toLowerCase() ?? ''
  const ext = isThumb ? 'jpg' : safeExtForMime(normalizedType, rawExt)
  const finalContentType = isThumb ? 'image/jpeg' : normalizedType
  const key = isThumb ? `thumbs/${albumId}/${uuid()}.jpg` : `albums/${albumId}/${uuid()}.${ext}`
  return { key, finalContentType }
}
