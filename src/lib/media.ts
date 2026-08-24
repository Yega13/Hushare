import type { Tier, UploadCaps } from '@/types'

export type MediaKind = 'image' | 'video'

// The formats we accept, and the SINGLE definition of them.
//
// These used to live only in lib/cloudflare/r2.ts, which imports the AWS SDK and the Cloudflare
// context and therefore cannot be imported by the browser at all. So the client had no way to ask
// the question and simply did not: it accepted anything whose MIME began with "image/", did the
// full decode-compress-thumbnail pipeline, and only found out at presign that the server would not
// take it. On 2026-08-23 a photographer lost that work on 113 MB files -- almost certainly TIFFs,
// which no browser can decode either, so every fallback in the pipeline failed too and the upload
// died with "File type not allowed" after the waiting was already spent.
//
// Kept here because this module is dependency-free and safe on both sides. r2.ts re-exports these
// so every existing server import keeps working, and the two sides can no longer drift.
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

export function isAllowedImage(mimeType: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(mimeType.toLowerCase())
}

export function isAllowedVideo(mimeType: string): boolean {
  return ALLOWED_VIDEO_TYPES.has(mimeType.toLowerCase())
}

const MB = 1024 * 1024
const GB = 1024 * MB

export const FREE_IMAGE_BYTES = 25 * MB
// Free video is capped at 50 MB (~30-60s phone clip) — enough for guest "moments" while
// bounding Cloudflare Stream storage/delivery cost on the free tier. Larger HD video is a paid
// perk (Pro 1 GB, Studio 4 GB). This matches the number the home + pricing pages advertise.
export const FREE_VIDEO_BYTES = 50 * MB
export const PRO_IMAGE_BYTES = 200 * MB
export const PRO_VIDEO_BYTES = 1 * GB
export const STUDIO_VIDEO_BYTES = 4 * GB

// Human-readable size for a cap in an error message. A 4 GB studio video cap read as "4096 MB",
// which nobody parses as a generous limit. Whole GB above the 1 GB mark, MB below it.
export function formatCapSize(bytes: number): string {
  if (bytes >= GB) {
    const gb = bytes / GB
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`
  }
  return `${Math.round(bytes / MB)} MB`
}

// The refusal a guest actually reads when a file is over this album's cap. Kept in ONE place so the
// client pre-check and the two server backstops cannot drift into three different explanations of
// the same rule.
//
// It names ONLY the cap, never the file's own size. /admin groups incidents by exact message
// string, so a number that changes per file (74 MB here, 63 MB there) would split one recurring
// problem into a column of one-count rows -- the same reason fetchWithRetry keeps its wait time out
// of the message. The actual size already travels in the report context, where it is recorded
// without touching the grouping.
//
// The advice is the point of the rewrite. On 2026-08-21 a guest hit this four times in eight
// minutes with the same 74 MB clip and then stopped uploading: the old text stated the limit and
// stopped there, which reads as "this is broken" rather than "here is what to do instead".
// Trimming is something every phone gallery app can already do, and it is the only route a GUEST
// has -- they cannot upgrade someone else's album, so an upsell here would be advice they are
// unable to act on.
export function tooLargeMessage(kind: MediaKind, capBytes: number): string {
  return kind === 'video'
    ? `File too large (max ${formatCapSize(capBytes)} for videos in this album). Trim it shorter in your phone, then try again.`
    : `File too large (max ${formatCapSize(capBytes)} for photos in this album).`
}

export function uploadCapsForTier(tier: Tier): UploadCaps {
  if (tier === 'studio') {
    return { image: PRO_IMAGE_BYTES, video: STUDIO_VIDEO_BYTES }
  }
  if (tier === 'pro') {
    return { image: PRO_IMAGE_BYTES, video: PRO_VIDEO_BYTES }
  }
  return { image: FREE_IMAGE_BYTES, video: FREE_VIDEO_BYTES }
}

export const DEFAULT_UPLOAD_CAPS: UploadCaps = uploadCapsForTier('free')

// Max total media (photos + videos) in ONE album.
// A guest album (no account) gets less than a registered free account — a nudge to sign up.
export const ANON_ALBUM_MEDIA = 250   // album owned by a guest (no account)
// 1000, not 250. The free cap sat 100 above the anonymous one, so creating an account
// bought a hundred more photos -- no reason to sign up, and a second wall the same afternoon.
// A real holiday or small event now finishes inside the free tier, and registering is a 4x jump
// rather than a rounding error. Photos are cheap in R2 (no egress); video is the cost driver and
// shares this cap deliberately, so a video-heavy album still stops early.
export const FREE_ALBUM_MEDIA = 1000  // registered free account
export const PRO_ALBUM_MEDIA = 3000
export const STUDIO_ALBUM_MEDIA = 10_000

// Cap for a REGISTERED owner by tier. Guest albums use ANON_ALBUM_MEDIA directly (see photos/create).
export function albumMediaCapForTier(tier: Tier): number {
  if (tier === 'studio') return STUDIO_ALBUM_MEDIA
  if (tier === 'pro') return PRO_ALBUM_MEDIA
  return FREE_ALBUM_MEDIA
}

// Max number of albums a user can own, by tier. Anon (no account) is a separate soft cap — kept
// BELOW the free registered cap so signing in always unlocks more.
export const ANON_ALBUM_LIMIT = 2
export const FREE_ALBUM_LIMIT = 3
export const PRO_ALBUM_LIMIT = 15
export const STUDIO_ALBUM_LIMIT = 50

export function albumCountLimitForTier(tier: Tier): number {
  if (tier === 'studio') return STUDIO_ALBUM_LIMIT
  if (tier === 'pro') return PRO_ALBUM_LIMIT
  return FREE_ALBUM_LIMIT
}

const IMAGE_EXT_FALLBACK = /\.(jpe?g|png|gif|webp|heic|heif)$/i
const VIDEO_EXT_FALLBACK = /\.(mp4|mov|m4v|webm)$/i

export function detectKind(file: File): MediaKind | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (IMAGE_EXT_FALLBACK.test(file.name)) return 'image'
  if (VIDEO_EXT_FALLBACK.test(file.name)) return 'video'
  return null
}

export function extensionFor(file: File, kind: MediaKind): string {
  const fromName = file.name.split('.').pop()?.toLowerCase()
  if (fromName && fromName.length <= 5) return fromName
  return kind === 'video' ? 'mp4' : 'jpg'
}

export type PosterResult = {
  blob: Blob | null   // best-effort poster frame; null if the seek/capture failed — duration is still valid
  width: number
  height: number
  // Intrinsic dimensions of the source video (not the downscaled poster) — used to store the
  // video's true aspect ratio at upload time.
  videoWidth: number
  videoHeight: number
  durationSeconds: number
}

export async function generateVideoPoster(file: File): Promise<PosterResult | null> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  video.src = url

  try {
    // Cancel timeout timers when the race resolves via the other branch — orphaned timers
    // accumulate under batch video uploads and waste memory until they eventually fire
    let t1: ReturnType<typeof setTimeout>
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true })
        video.addEventListener('error', () => reject(new Error('video decode failed')), { once: true })
      }),
      new Promise<never>((_, reject) => { t1 = setTimeout(() => reject(new Error('loadedmetadata timeout')), 8_000) }),
    ]).finally(() => clearTimeout(t1))

    // Duration + intrinsic dimensions are known NOW (from loadedmetadata). Capture them BEFORE the
    // seek, so a slow or failed poster capture can never cost us the duration shown in the grid.
    const durationSeconds = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
    const vw = video.videoWidth
    const vh = video.videoHeight

    // Poster frame is BEST-EFFORT and must never reject the whole result. Keep the seek light —
    // ~1s in skips the black / fade-in opening frame without the deep-seek cost that was timing out
    // on slower phones (which lost both the poster AND the duration).
    let blob: Blob | null = null
    let cw = vw
    let ch = vh
    try {
      const target = durationSeconds >= 2 ? Math.min(Math.max(durationSeconds * 0.1, 1), 1.5) : (durationSeconds > 0 ? durationSeconds * 0.5 : 0.3)
      video.currentTime = target

      let t2: ReturnType<typeof setTimeout>
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          video.addEventListener('seeked', () => resolve(), { once: true })
          video.addEventListener('error', () => reject(new Error('seek failed')), { once: true })
        }),
        new Promise<never>((_, reject) => { t2 = setTimeout(() => reject(new Error('seeked timeout')), 5_000) }),
      ]).finally(() => clearTimeout(t2))

      const w = video.videoWidth
      const h = video.videoHeight
      if (w && h) {
        // 1080px so the poster stays crisp on large/high-DPR tiles. Still tiny next to the video.
        const MAX_POSTER_DIM = 1080
        const longest = Math.max(w, h)
        const scale = longest > MAX_POSTER_DIM ? MAX_POSTER_DIM / longest : 1
        cw = Math.max(1, Math.round(w * scale))
        ch = Math.max(1, Math.round(h * scale))
        const canvas = document.createElement('canvas')
        canvas.width = cw
        canvas.height = ch
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(video, 0, 0, cw, ch)
          blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92))
        }
      }
    } catch { /* poster best-effort — keep the duration/dimensions we already captured */ }

    return { blob, width: cw, height: ch, videoWidth: vw, videoHeight: vh, durationSeconds }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
    video.src = ''  // release internal decode buffer immediately rather than waiting for GC
  }
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return ''
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
