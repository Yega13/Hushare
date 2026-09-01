import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getCloudflareContext } from '@opennextjs/cloudflare'

// Re-exported from lib/media so the browser and the server cannot disagree about what we accept.
// This file imports the AWS SDK and the Cloudflare context, so it can never be imported client-side
// -- which is exactly how the client ended up with no check at all.
export { ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES, isAllowedImage, isAllowedVideo } from '@/lib/media'

export const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/jpg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/heic': ['heic'],
  'image/heif': ['heif'],
  'video/mp4': ['mp4'],
  'video/quicktime': ['mov'],
  'video/webm': ['webm'],
  'video/ogg': ['ogg'],
  'video/x-m4v': ['m4v'],
}

export function safeExtForMime(mimeType: string, clientExt: string): string {
  const normalized = mimeType.toLowerCase()
  const allowed = MIME_TO_EXTENSIONS[normalized]
  if (!allowed) return 'bin'
  // For HEIC/HEIF always force the canonical extension regardless of client filename
  if (normalized === 'image/heic') return 'heic'
  if (normalized === 'image/heif') return 'heif'
  const clean = clientExt.toLowerCase()
  return allowed.includes(clean) ? clean : allowed[0]
}

let _s3Client: S3Client | null = null

function getS3Client(): S3Client {
  if (_s3Client) return _s3Client
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing R2 credentials (CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)')
  }

  _s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // Path-style: presign as `<account>.r2.cloudflarestorage.com/<bucket>/<key>` instead
    // of the default virtual-hosted `<bucket>.<account>.r2.cloudflarestorage.com`. The
    // browser upload's CSP connect-src only allows the account host, so the bucket-
    // subdomain host was blocked by CSP → every photo failed with "Network error during
    // upload". Path-style keeps the host on the CSP allowlist.
    forcePathStyle: true,
    // AWS SDK v3 (>=3.729) adds a default CRC32 integrity checksum to PutObject.
    // For a *presigned* browser PUT this bakes an x-amz-checksum requirement into the
    // signature that the browser never satisfies, so R2 rejects the upload — which the
    // browser surfaces as a CORS "Network error during upload". R2 doesn't need it;
    // only compute checksums when an operation actually requires one.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
  return _s3Client
}

// Every key we presign a PUT for is a fresh uuid() — the object at a given key never changes —
// so it is safe for browsers/CDN to cache indefinitely without revalidating on repeat visits.
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

export async function createPresignedPut(
  key: string,
  contentType: string,
  expiresInSeconds = 3600,
  contentLength: number,  // required — constraining size in the signature prevents tier-cap bypass
  cacheControl: string = IMMUTABLE_CACHE_CONTROL,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: 'hushare-media',
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
    CacheControl: cacheControl,
  })
  // CONTENT-TYPE MUST BE IN THE SIGNATURE, and it takes an explicit override to get it there.
  //
  // @aws-sdk/s3-request-presigner calls `unsignableHeaders.add("content-type")` before signing, so
  // ContentType above shaped nothing: R2 stored whatever type the PUT actually carried. A stranger
  // could presign as image/jpeg and PUT `Content-Type: text/html`, and the object then served
  // executable HTML from videos.hushare.space — a sibling of the app, where the app's CSP and
  // nosniff headers do not reach, and where a page can set cookies on .hushare.space. The
  // allow-list of image types only ever filtered the DECLARED type, so it bought nothing here.
  //
  // signableHeaders wins over that exclusion in @smithy/signature-v4's getCanonicalHeaders, which
  // is what makes this the fix rather than a hopeful option: the browser must now send exactly the
  // type we signed or R2 rejects the upload. tests/r2-presign.test.ts asserts the signed set, so a
  // future SDK bump that quietly drops it fails the suite instead of reopening the hole.
  return getSignedUrl(getS3Client(), command, {
    expiresIn: expiresInSeconds,
    signableHeaders: new Set(['content-type']),
  })
}

export async function createPresignedGet(
  key: string,
  contentDisposition: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: 'hushare-media',
    Key: key,
    ResponseContentDisposition: contentDisposition,
  })
  return getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds })
}

export function r2PublicUrl(key: string): string {
  const rawHost = process.env.R2_PUBLIC_HOST
  if (!rawHost) throw new Error('R2_PUBLIC_HOST not set')
  // Strip any accidental scheme prefix from the env var (e.g. "https://cdn.host" → "cdn.host")
  const host = rawHost.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return `https://${host}/${key}`
}

// Deletes the R2 object a public URL (as returned by r2PublicUrl, or a caller-stripped variant of
// one — e.g. background's "image:" values with the prefix already removed) points at. Best-effort,
// non-fatal, and fire-and-forget: scheduled via waitUntil so the caller never waits on object
// storage before replying, and any failure is logged, never thrown. Silently no-ops if the URL
// isn't ours or R2_PUBLIC_HOST/the bucket binding isn't available — callers don't pre-check any of
// that themselves. Shared by every route that replaces or clears a previously R2-hosted image
// (album cover/header photo, album background) so the cleanup logic can't drift between them.
// Does this public URL point at an asset belonging to THIS album?
//
// The design-asset routes (logo, header image, background, sponsor logos) accept a URL from the
// client and store it, then delete whatever URL the album held before. They validated the host and
// the bare prefix — `/logos/`, `/headers/`, `/backgrounds/`, `/sponsors/` — but never checked WHOSE
// album the key belonged to, even though the upload routes mint every key album-scoped as
// `logos/{albumId}/{uuid}.ext`. The album id was sitting in the path, unread.
//
// That made every album's design assets destroyable by any other album's owner in two requests:
// point your own album at a victim's URL (passes the prefix check), then set yours to null and the
// route deletes the victim's object from the shared bucket. Permanent, no audit trail, and aimed
// squarely at paying customers — logos and sponsor logos are paid features, and sponsor branding on
// a race album is contractual.
//
// Must be called AFTER ownership is verified: the album id is not known before that. Lives here,
// beside the delete it protects, so the four routes share one rule instead of four copies that
// drift — the drift is what produced the bug.
export function isOwnAlbumAsset(
  url: string,
  prefix: string,
  albumId: string,
  r2Host: string,
): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.origin !== `https://${r2Host}`) return false
    if (parsed.pathname.includes('..')) return false
    return parsed.pathname.startsWith(`/${prefix}/${albumId}/`)
  } catch {
    return false
  }
}

export function deleteR2ObjectByPublicUrl(url: string): void {
  const rawHost = process.env.R2_PUBLIC_HOST
  if (!rawHost) return
  const host = rawHost.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const prefix = `https://${host}/`
  if (!url.startsWith(prefix)) return
  const key = url.slice(prefix.length).split('?')[0]
  if (!key) return

  const ctx = getCloudflareContext()
  const bucket = (ctx?.env as { R2_BUCKET?: { delete(k: string | string[]): Promise<void> } } | undefined)?.R2_BUCKET
  if (!bucket) return
  const p = bucket.delete(key).catch((e: unknown) => {
    console.error('[r2] failed to delete object:', key, e instanceof Error ? e.message : String(e))
  })
  try { ctx.ctx.waitUntil(p) } catch { void p }
}
