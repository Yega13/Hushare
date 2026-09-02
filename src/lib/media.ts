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
// 200 MB, not 50. An ordinary phone clip is 60-100 MB, so a 50 MB cap did not refuse "large" video
// — it refused video. One iPhone user was turned away 18 times in a single session by it. Photos and
// videos share the same per-album allowance, so a generous per-file size costs nothing extra: an
// album full of video is an album that ran out of items sooner.
export const FREE_VIDEO_BYTES = 200 * MB
export const PRO_IMAGE_BYTES = 200 * MB
export const PRO_VIDEO_BYTES = 1 * GB
export const STUDIO_VIDEO_BYTES = 4 * GB

// Human-readable size for a cap in an error message. A 4 GB studio video cap read as "4096 MB",
// which nobody parses as a generous limit. Whole GB above the 1 GB mark, MB below it.
//
// LOCALE-AWARE UNITS, because this string gets interpolated into translated copy. When the homepage
// FAQ switched from hand-typed numbers to interpolation (the hand-typed Russian said 50 MB while
// the code allowed 200), the fix quietly swapped the Cyrillic and Armenian unit words for Latin
// "MB" — a regression riding in on a correction. The unit table keeps the interpolation honest in
// every language it feeds. Default stays 'en' so error messages and existing callers are unchanged.
const SIZE_UNITS: Record<string, { mb: string; gb: string }> = {
  en: { mb: 'MB', gb: 'GB' },
  ru: { mb: String.fromCharCode(1052, 1041), gb: String.fromCharCode(1043, 1041) },          // МБ / ГБ
  hy: { mb: String.fromCharCode(1348, 1330), gb: String.fromCharCode(1331, 1330) },          // ՄԲ / ԳԲ
}

export function formatCapSize(bytes: number, locale: string = 'en'): string {
  const units = SIZE_UNITS[locale] ?? SIZE_UNITS.en
  if (bytes >= GB) {
    const gb = bytes / GB
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} ${units.gb}`
  }
  return `${Math.round(bytes / MB)} ${units.mb}`
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
// COMFORTABLY ABOVE ANON_ALBUM_MEDIA, and the ratio is the point. The free cap once sat 100 above
// the anonymous one, so creating an account bought a hundred more photos — no reason to sign up,
// and a second wall the same afternoon. A real holiday or small event now finishes inside the free
// tier, and registering is a real step up rather than a rounding error.
//
// NO NUMBERS IN THIS PARAGRAPH. It used to open "1000, not 250" and call it "a 4x jump", above a
// constant of 500 — the numbers were written when the cap was 1000 and were never revised when it
// came down, so the explanation of the value contradicted the value, one line apart. The cap is
// published on /pricing and pinned by tests/limits-and-classifiers.test.ts against a literal; prose
// that restates it can only ever go stale (MISTAKES entry 3, where a free video cap typed into three
// translations left two of them a quarter of the truth).
//
// Photos are cheap in R2 (no egress); video is the cost driver and shares this cap deliberately, so
// a video-heavy album still stops early.
export const FREE_ALBUM_MEDIA = 500   // registered free account

// What free albums used to get, kept for the ones that already have it.
//
// ONE SHARED ALLOWANCE for photos and videos, not two. A separate video count was considered and
// dropped: across the whole library video is 1.4% of everything (132 of 9,490) and the most any one
// album has ever held is 22, so a second number would have existed to govern a case that has never
// occurred — at the cost of a second number to explain on the pricing page.
export const LEGACY_FREE_ALBUM_MEDIA = 1000

// Albums created before this keep the old allowance, for as long as they exist.
//
// Lowering a limit is not like raising one: somewhere out there is an album at 700 items whose owner
// arranged a wedding around it, and taking 200 photos' worth of room away from them retroactively
// would be indefensible whatever the pricing page now says. Five albums are already over 500 and the
// largest holds 985.
//
// The date attaches to the ALBUM, not the owner: a new album made tomorrow by someone who has had an
// account for months gets today's allowance, because that is what "created before" means.
export const GRANDFATHER_FREE_BEFORE = Date.parse('2026-08-25T00:00:00Z')
export const PRO_ALBUM_MEDIA = 3000
export const STUDIO_ALBUM_MEDIA = 10_000

// Cap for a REGISTERED owner by tier — what a plan gives TODAY. Guest albums use ANON_ALBUM_MEDIA
// directly (see photos/create). Use this for anything that describes the plan: pricing, the account
// dashboard, the celebration card.
export function albumMediaCapForTier(tier: Tier): number {
  if (tier === 'studio') return STUDIO_ALBUM_MEDIA
  if (tier === 'pro') return PRO_ALBUM_MEDIA
  return FREE_ALBUM_MEDIA
}

// The per-ALBUM cap used to live here as albumMediaCapForAlbum. It moved to
// lib/album-entitlements, which also accounts for media_cap_override and for the second
// grandfather date this function never knew about — and it was deleted rather than left behind,
// because an exported function with no callers that still LOOKS like the answer is how a codebase
// grows a second answer. albumMediaCapForTier below stays: it describes a PLAN, which is the right
// thing for the pricing page and the account dashboard to read.

// Max number of albums a user can own, by tier. Anon (no account) is a separate soft cap — kept
// BELOW the free registered cap so signing in always unlocks more.
export const ANON_ALBUM_LIMIT = 2
// The BACKSTOP behind that soft cap, per IP per day.
//
// ANON_ALBUM_LIMIT is a per-device cookie listing the albums you made — good UX, because deleting an
// album frees its slot, but it is self-reported: simply not sending the cookie made the cap vanish,
// leaving only a 30/hour rate limit, so one script could open 720 albums a day. Deliberately set far
// above what a person could ever want (the honest path stops at 2 with an invitation to register),
// so it is invisible to real use and only ever bites automation.
//
// Per IP per DAY rather than a lifetime total: a venue's wifi or a mobile carrier's CGNAT puts many
// unrelated people behind one address, and a permanent counter would eventually lock all of them
// out for something a stranger did months ago.
export const ANON_ALBUM_DAILY_IP_LIMIT = 10
export const FREE_ALBUM_LIMIT = 3
export const PRO_ALBUM_LIMIT = 15
// Lowered 50 -> 40 on 2026-08-31. Checked first: the largest account holds 11 albums, so nobody
// alive loses anything — and lowering a limit is not like raising one, so it must never be done
// without that check. It also pulls in the worst case that made Max awkward to price: the video
// allowance multiplies by this number, and 50 albums put the theoretical ceiling above the plan's
// own revenue.
export const STUDIO_ALBUM_LIMIT = 40

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
