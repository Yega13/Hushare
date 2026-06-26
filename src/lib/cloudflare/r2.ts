import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
])

export const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/ogg',
  'video/x-m4v',
])

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

export function isAllowedImage(mimeType: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(mimeType.toLowerCase())
}

export function isAllowedVideo(mimeType: string): boolean {
  return ALLOWED_VIDEO_TYPES.has(mimeType.toLowerCase())
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
  })
  return _s3Client
}

export async function createPresignedPut(
  key: string,
  contentType: string,
  expiresInSeconds = 3600,
  contentLength: number,  // required — constraining size in the signature prevents tier-cap bypass
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: 'hushare-media',
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  })
  return getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds })
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
