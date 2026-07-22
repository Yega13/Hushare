import { NextResponse } from 'next/server'
import { createPresignedPut, r2PublicUrl } from '@/lib/cloudflare/r2'
import { authorizeImageUpload, deriveImageKey } from '@/lib/server/image-upload-authorization'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { v4 as uuid } from 'uuid'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Client thumbnails are ~20–80KB JPEGs; 8MB is a generous ceiling that still blocks abuse of
// the thumb slot as a second full-size upload channel.
const MAX_THUMB_BYTES = 8 * 1024 * 1024

type Body = {
  albumId?: unknown
  fileName?: unknown
  contentType?: unknown
  fileSize?: unknown
  isThumb?: unknown
  thumbSize?: unknown
}

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as Body | null
  const { albumId, fileName, contentType, fileSize, isThumb, thumbSize } = body ?? {}

  if (
    typeof albumId !== 'string' || !UUID_RE.test(albumId) ||
    typeof fileName !== 'string' || !fileName || fileName.length > 255 ||
    typeof contentType !== 'string' || !contentType ||
    typeof fileSize !== 'number' || !Number.isFinite(fileSize) || !Number.isInteger(fileSize) || fileSize <= 0
  ) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400, headers: NO_STORE })
  }

  // Optional paired-thumbnail presign: one round trip covers the image AND its ~30KB thumbnail
  // (the client used to make a second full presign call per photo just for the thumb).
  if (
    thumbSize !== undefined &&
    (typeof thumbSize !== 'number' || !Number.isFinite(thumbSize) || !Number.isInteger(thumbSize) ||
      thumbSize <= 0 || thumbSize > MAX_THUMB_BYTES)
  ) {
    return NextResponse.json({ error: 'Invalid thumbSize' }, { status: 400, headers: NO_STORE })
  }

  // Shared with /api/upload/image-relay (src/lib/server/image-upload-authorization.ts) — file
  // type/size checks, rate limits, album + guest_uploads_enabled check, tier cap check. Identical
  // behavior to before this was extracted; only the code location moved.
  const auth = await authorizeImageUpload(req, { albumId, contentType, fileSize })
  if (!auth.ok) return auth.response

  // thumbOnly is always false here — this route never presigns a THUMBNAIL as the primary upload
  // (that's isThumb=true, used only by the video-poster path via a separate call with no paired
  // thumb of its own). The paired thumbKey below is generated inline (not via deriveImageKey) since
  // it has its own independent uuid()/key and doesn't share the main image's key derivation.
  const isThumbOnly = isThumb === true
  const { key, finalContentType } = deriveImageKey(albumId, contentType, fileName, isThumbOnly)
  // A paired thumb only makes sense for a main-image presign
  const thumbKey = !isThumbOnly && typeof thumbSize === 'number'
    ? `thumbs/${albumId}/${uuid()}.jpg`
    : null

  let presignedUrl: string
  let thumbPresignedUrl: string | null = null
  let publicUrl: string
  try {
    ;[presignedUrl, thumbPresignedUrl] = await Promise.all([
      createPresignedPut(key, finalContentType, 3600, fileSize),
      thumbKey ? createPresignedPut(thumbKey, 'image/jpeg', 3600, thumbSize as number) : Promise.resolve(null),
    ])
    publicUrl = r2PublicUrl(key)
  } catch (e) {
    console.error('[presign] presign/r2url failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Could not generate upload URL' }, { status: 502, headers: NO_STORE })
  }

  return NextResponse.json(
    {
      presignedUrl,
      key,
      publicUrl,
      ...(thumbKey && thumbPresignedUrl
        ? { thumb: { presignedUrl: thumbPresignedUrl, key: thumbKey, publicUrl: r2PublicUrl(thumbKey) } }
        : {}),
    },
    { headers: NO_STORE },
  )
}
