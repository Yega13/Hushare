import { NextResponse } from 'next/server'
import { v4 as uuid } from 'uuid'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedImage, safeExtForMime } from '@/lib/cloudflare/r2'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { uploadCapsForTier } from '@/lib/media'
import { getUserTierById } from '@/lib/subscriptions'
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
  | { ok: true; tier: Tier }
  | { ok: false; response: Response }

// Re-runs the EXACT validation /api/upload/presign already performed: file type allowed, absolute
// size ceiling, per-IP rate limit ∥ album lookup (exists, not retired, guest_uploads_enabled),
// per-album rate limit ∥ tier lookup, and the tier's image size cap. Does NOT touch storage —
// callers derive a key separately via deriveImageKey() once authorized.
export async function authorizeImageUpload(
  req: Request,
  params: { albumId: string; contentType: string; fileSize: number },
): Promise<ImageUploadAuthResult> {
  const normalizedType = params.contentType.toLowerCase()
  if (!isAllowedImage(normalizedType)) {
    return { ok: false, response: NextResponse.json({ error: 'File type not allowed' }, { status: 415, headers: NO_STORE }) }
  }
  if (params.fileSize > MAX_FILESIZE_HARD_CAP) {
    return { ok: false, response: NextResponse.json({ error: 'File too large' }, { status: 413, headers: NO_STORE }) }
  }

  const admin = createAdminClient()

  // The IP rate limit and the album lookup are independent — run them in parallel and check the
  // limiter's verdict first (same ordering/reasoning as the original presign route).
  const [ipRl, albumRes] = await Promise.all([
    checkRateLimit(clientIpKey(req, 'presign_ip'), 3600, 12000, { failOpen: false }),
    admin
      .from('albums')
      .select('id, user_id, guest_uploads_enabled')
      .eq('id', params.albumId)
      .is('retired_at', null)
      .maybeSingle<{ id: string; user_id: string | null; guest_uploads_enabled: boolean }>(),
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

  const [albumRl, tierRes] = await Promise.all([
    checkRateLimit(`presign_album:${params.albumId}`, 3600, 40000, { failOpen: false }),
    getUserTierById(album.user_id)
      .then(tier => ({ tier, error: null as unknown }))
      .catch((error: unknown) => ({ tier: null, error })),
  ])
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

  const caps = uploadCapsForTier(tierRes.tier)
  if (params.fileSize > caps.image) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `File too large (max ${caps.image / 1024 / 1024} MB for your tier)` },
        { status: 413, headers: NO_STORE },
      ),
    }
  }

  return { ok: true, tier: tierRes.tier }
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
