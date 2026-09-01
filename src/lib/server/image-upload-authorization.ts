import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { v4 as uuid } from 'uuid'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedImage, safeExtForMime } from '@/lib/cloudflare/r2'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { presignBudget } from '@/lib/presign-budget'
import { uploadCapsForTier, tooLargeMessage } from '@/lib/media'
import { albumCap as albumCapFor, albumEffectiveTier } from '@/lib/album-entitlements'
import { getUserTierById } from '@/lib/subscriptions'
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
const MAX_FILESIZE_HARD_CAP = 200 * 1024 * 1024 // 200 MB absolute ceiling regardless of tier

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
  const normalizedType = params.contentType.toLowerCase()
  if (!isAllowedImage(normalizedType)) {
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
      .maybeSingle<{
        id: string; user_id: string | null; guest_uploads_enabled: boolean
        media_cap_override: number | null; created_at: string
        package_tier: 'pro' | 'studio' | null; package_expires_at: string | null
        owner_token: string; password_hash: string | null; reveal_at: string | null
      }>(),
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
    getUserTierById(album.user_id)
      .then(tier => ({ tier, error: null as unknown }))
      .catch((error: unknown) => ({ tier: null, error })),
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
  const { cap: albumCap } = albumCapFor({
    // `album.user_id ? ... : null` matters: getUserTierById(null) returns 'free' rather than
    // throwing, so passing the tier straight through told albumCap that an ANONYMOUS album was a
    // free-account album — 500 instead of 250, or 1,000 once the free grandfathering applied.
    // Every anonymous album alive today predates that date, so it doubled the hourly presign
    // budget for all of them: ~100 GB/hour of R2 writes that no database row will ever reference
    // and no audit can reconcile. The bytes are permanent; see lib/presign-budget.
    ownerTier: album.user_id ? (tierRes.tier ?? 'free') : null,
    createdAt: album.created_at,
    override: album.media_cap_override,
    pkg: { tier: album.package_tier, expiresAt: album.package_expires_at },
  })
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
    console.error('[image-upload-auth] getUserTierById failed:', tierRes.error instanceof Error ? tierRes.error.message : String(tierRes.error))
    return { ok: false, response: NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503, headers: NO_STORE }) }
  }

  const caps = uploadCapsForTier(albumEffectiveTier(album.user_id ? tierRes.tier : null, {
    tier: album.package_tier, expiresAt: album.package_expires_at,
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
