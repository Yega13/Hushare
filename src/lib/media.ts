import type { Tier, UploadCaps } from '@/types'

export type MediaKind = 'image' | 'video'

const MB = 1024 * 1024
const GB = 1024 * MB

export const FREE_IMAGE_BYTES = 25 * MB
export const FREE_VIDEO_BYTES = 200 * MB
export const PRO_IMAGE_BYTES = 200 * MB
export const PRO_VIDEO_BYTES = 1 * GB
export const STUDIO_VIDEO_BYTES = 4 * GB

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
  blob: Blob
  width: number
  height: number
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

    const target = Math.min(0.5, Math.max(0, (video.duration || 1) * 0.05))
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
    if (!w || !h) return null

    // 1080px so the poster stays crisp on large/high-DPR tiles (a 720px frame looked soft in
    // a 2-column grid on a retina phone). Still tiny next to the video file.
    const MAX_POSTER_DIM = 1080
    const longest = Math.max(w, h)
    const scale = longest > MAX_POSTER_DIM ? MAX_POSTER_DIM / longest : 1
    const cw = Math.max(1, Math.round(w * scale))
    const ch = Math.max(1, Math.round(h * scale))

    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(video, 0, 0, cw, ch)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92),
    )
    if (!blob) return null

    return { blob, width: cw, height: ch, durationSeconds: Number.isFinite(video.duration) ? video.duration : 0 }
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
