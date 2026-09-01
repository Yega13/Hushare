import type { CollectionSummary } from '@/components/owner-toolbar/types'
import type { MediaDisplayFilter, MobileGridColumns, SlideshowAnimation } from '@/lib/media-display'
import type { SponsorLogo, SlideshowMotion } from '@/types'
import { readFileRobust } from '@/lib/file-read'

async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T
}

export async function fetchCollections(slug: string): Promise<CollectionSummary[]> {
  const params = new URLSearchParams({ slug })
  const res = await fetch(`/api/collections?${params.toString()}`)
  const body = await jsonBody<{ collections?: CollectionSummary[] }>(res)
  return res.ok ? body.collections ?? [] : []
}

export async function saveCustomUrlRequest(
  slug: string,
  customSlug: string | null,
): Promise<{ ok: true; custom_slug: string | null } | { ok: false; error: string }> {
  const res = await fetch('/api/album/custom-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, custom_slug: customSlug }),
  })
  const body = await jsonBody<{ error?: string; custom_slug?: string | null }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  return { ok: true, custom_slug: body.custom_slug ?? null }
}

export async function savePasswordRequest(
  slug: string,
  password: string | null,
): Promise<{ ok: true; password_protected: boolean } | { ok: false; error: string }> {
  const res = await fetch('/api/album/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, password }),
  })
  const body = await jsonBody<{ error?: string; password_protected?: boolean }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  return { ok: true, password_protected: !!body.password_protected }
}

export async function saveBackgroundRequest(
  slug: string,
  backgroundTheme: string | null,
): Promise<{ ok: true; background_theme: string | null } | { ok: false; error: string }> {
  const res = await fetch('/api/album/background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, background_theme: backgroundTheme }),
  })
  const body = await jsonBody<{ error?: string; background_theme?: string | null }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  // The route returns { ok: true } without echoing background_theme — fall back to the sent value.
  return { ok: true, background_theme: body.background_theme !== undefined ? body.background_theme : backgroundTheme }
}

export async function saveDesignRequest(
  slug: string,
  fields: { accent_color?: string | null; welcome_message?: string | null; title_font?: string | null; template?: string | null; photo_style?: string | null; header_focal?: string | null; header_zoom?: number | null; header_video_mode?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/album/design', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, ...fields }),
  })
  const body = await jsonBody<{ error?: string }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  return { ok: true }
}

export type MediaSettingsChanges = Partial<{
  media_radius: number
  video_autoplay: boolean
  media_filter: MediaDisplayFilter
  mobile_grid_columns: MobileGridColumns
  slideshow_interval_ms: number
  slideshow_animation: SlideshowAnimation
}>

// SENDS ONLY WHAT CHANGED — this used to thread seven positional settings and post all of them
// from local state on every save. That made every save a write of every field, so a tab holding a
// stale phone-grid value silently re-wrote it whenever the owner dragged the RADIUS: set desktop
// 6 and phone 3, come back later, both are 6. The route always updated only the fields present in
// the body; it was this function that insisted on presenting everything it half-knew.
export async function saveMediaSettingsRequest(
  slug: string,
  changes: MediaSettingsChanges,
  resetRadiusOverrides: boolean,
  resetFilterOverrides: boolean,
): Promise<{ ok: true; applied: MediaSettingsChanges } | { ok: false; error: string }> {
  const res = await fetch('/api/album/media-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug,
      ...changes,
      reset_radius_overrides: resetRadiusOverrides,
      reset_filter_overrides: resetFilterOverrides,
    }),
  })
  const body = await jsonBody<{ error?: string } & MediaSettingsChanges>(res)
  if (!res.ok) {
    return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  }
  // The route echoes back exactly the fields it applied; undefined keys vanish in JSON, so what
  // arrives is the applied subset and nothing else.
  const applied: MediaSettingsChanges = {}
  if (body.media_radius !== undefined) applied.media_radius = body.media_radius
  if (body.video_autoplay !== undefined) applied.video_autoplay = body.video_autoplay
  if (body.media_filter !== undefined) applied.media_filter = body.media_filter
  if (body.mobile_grid_columns !== undefined) applied.mobile_grid_columns = body.mobile_grid_columns
  if (body.slideshow_interval_ms !== undefined) applied.slideshow_interval_ms = body.slideshow_interval_ms
  if (body.slideshow_animation !== undefined) applied.slideshow_animation = body.slideshow_animation
  return { ok: true, applied }
}

// Storable image types for a design asset. Deliberately narrower than the main photo pipeline's
// server-side set: a header/logo/background is drawn by an <img> in every browser, so HEIC has no
// place here even though R2 would accept it.
const STORABLE_DESIGN_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

// How large a re-encoded design asset is allowed to be. A logo renders at ~64px and a header band
// at a page width, so these are generous; they exist to stop a phone's 12 MP original becoming a
// multi-megabyte re-encode.
export const LOGO_MAX_EDGE = 1024
export const DESIGN_IMAGE_MAX_EDGE = 2560
// Mirror the server caps: /api/album/logo/upload and /api/album/sponsor-logo/upload allow 5 MB,
// header-image and background allow 10 MB. Exceeding these is a resize, not an error — see
// prepareDesignImage.
export const LOGO_MAX_BYTES = 5 * 1024 * 1024
export const DESIGN_IMAGE_MAX_BYTES = 10 * 1024 * 1024

// Last-resort recovery + normalisation for pictures picked on a phone.
//
// readFileRobust() covers arrayBuffer(), FileReader and blob-URL fetch. On some Android devices a
// picked file is "displayable but not byte-readable": every one of those paths fails, yet an <img>
// element renders it perfectly. Drawing that <img> to a canvas produces fresh, valid bytes.
// UploadZone already relies on this to fix the identical "Could not read this file" failure for
// photo uploads; the logo and background pickers never got it, so choosing a logo on an Android
// phone simply failed with no way forward.
// A design asset is drawn at a few hundred pixels at most, so there is no reason to carry a 12 MP
// original through the re-encode — and every reason not to: a lossless PNG of one is easily 20 MB,
// which would blow straight past the logo route's 5 MB cap and turn a recovered upload into a
// different error. Cap the long edge, prefer WebP, and fall back down the format list for older
// canvas implementations.
const CANVAS_ENCODE_ORDER: Array<[type: string, quality: number]> = [
  ['image/webp', 0.9],
  ['image/jpeg', 0.92],
  ['image/png', 1],
]

async function reencodeViaCanvas(file: File, maxEdge: number): Promise<{ blob: Blob; type: string } | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => resolve(null)
      el.src = url
    })
    if (!img || !img.naturalWidth || !img.naturalHeight) return null
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const [type, quality] of CANVAS_ENCODE_ORDER) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
      // A canvas that can't produce the requested type silently falls back to PNG, so trust the
      // blob's own type rather than the one we asked for — that mismatch is what the presigned
      // signature would reject.
      if (blob && blob.size > 0 && STORABLE_DESIGN_TYPES.has(blob.type)) {
        return { blob, type: blob.type }
      }
    }
    return null
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Turn whatever the device's picker handed us into bytes we can actually sign for and store.
//
// Two things go wrong on a phone and neither is the owner's fault:
//   - The picker reports no type at all, or image/heic from an iPhone. Presigning under that type
//     is either rejected outright (415) or produces a stored file no browser can draw.
//   - The File is "displayable but not byte-readable" — every read path fails, yet an <img> renders
//     it perfectly (a stale Android content-provider reference).
// Both are fixed the same way: redraw it through a canvas. The returned `type` is what the bytes
// REALLY are, and it is the only type used from here on — presign, PUT header and Blob label all
// agree. They used to disagree (the presign got file.type while the blob was PNG), which silently
// broke every recovery: "logo — error", with nothing the owner could do about it.
async function prepareDesignImage(
  file: File,
  maxEdge: number,
  maxBytes: number,
): Promise<{ ok: true; blob: Blob; type: string } | { ok: false; error: string }> {
  if (STORABLE_DESIGN_TYPES.has(file.type)) {
    try {
      const bytes = await readFileRobust(file)
      if (bytes.byteLength <= maxBytes) {
        return { ok: true, blob: new Blob([bytes], { type: file.type }), type: file.type }
      }
      // Storable, but bigger than the endpoint will take. Falling through re-encodes it down
      // instead of telling the owner their picture is too big — a phone camera shot is always over
      // the logo cap, and "pick a smaller one" is not an instruction anybody can act on.
    } catch {
      // Unreadable bytes — fall through to the canvas path rather than giving up.
    }
  }
  const recovered = await reencodeViaCanvas(file, maxEdge)
  if (!recovered) {
    return { ok: false, error: 'Could not read this image from your device. Please pick a different one.' }
  }
  if (recovered.blob.size > maxBytes) {
    return { ok: false, error: `That image is too detailed to use here (over ${Math.round(maxBytes / 1024 / 1024)} MB even after resizing).` }
  }
  return { ok: true, blob: recovered.blob, type: recovered.type }
}

export async function uploadBackgroundRequest(
  slug: string,
  file: File,
): Promise<{ ok: true; background_theme: string } | { ok: false; error: string }> {
  // Snapshot the picked file's bytes into memory FIRST. On Android a gallery/camera File can
  // have a stale content-provider reference; PUTting it directly made fetch() fail to read the
  // request body — surfacing as the "Failed to fetch" error. Reading into an in-memory Blob
  // (with retries + FileReader fallback) makes the upload immune to that.
  const prepared = await prepareDesignImage(file, DESIGN_IMAGE_MAX_EDGE, DESIGN_IMAGE_MAX_BYTES)
  if (!prepared.ok) return prepared
  const { blob, type: uploadType } = prepared

  // Step 1: get a presigned PUT URL from the server
  const presignRes = await fetch('/api/album/background/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug,
      contentType: uploadType,
      fileName: file.name,
      fileSize: blob.size,
    }),
  })
  const presignBody = await jsonBody<{
    error?: string
    presignedUrl?: string
    backgroundTheme?: string
  }>(presignRes)
  if (!presignRes.ok || !presignBody.presignedUrl || !presignBody.backgroundTheme) {
    return { ok: false, error: presignBody.error ?? `Upload failed (${presignRes.status})` }
  }

  // Step 2: PUT the in-memory blob to R2 via the presigned URL. Cache-Control must match
  // IMMUTABLE_CACHE_CONTROL in src/lib/cloudflare/r2.ts exactly — it's bound into the presigned
  // signature, so any mismatch is rejected by R2 as SignatureDoesNotMatch. Each background upload
  // gets a fresh uuid() key (see background/upload/route.ts), so caching it forever is safe.
  // (Content-Length is set automatically by the browser from the blob; setting it manually is a
  // no-op — it's a forbidden header — and the raw-File read is what actually used to fail.)
  let putRes: Response
  try {
    putRes = await fetch(presignBody.presignedUrl, {
      method: 'PUT',
      body: blob,
      headers: {
        'Content-Type': uploadType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return { ok: false, error: 'Upload to storage failed (network error). Please try again.' }
  }
  if (!putRes.ok) {
    return { ok: false, error: `Upload to storage failed (${putRes.status})` }
  }

  // Step 3: persist the new background_theme value in the album DB row
  const saveRes = await fetch('/api/album/background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, background_theme: presignBody.backgroundTheme }),
  })
  const saveBody = await jsonBody<{ error?: string }>(saveRes)
  if (!saveRes.ok) {
    return { ok: false, error: saveBody.error ?? `Save failed (${saveRes.status})` }
  }

  return { ok: true, background_theme: presignBody.backgroundTheme }
}

export async function saveHeaderImageRequest(
  slug: string,
  url: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/album/header-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, header_image: url }),
  })
  const body = await jsonBody<{ error?: string }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  return { ok: true }
}

// Uploads an arbitrary picture to R2 via a presign endpoint that returns {presignedUrl, publicUrl}
// (header-image/upload, logo/upload, and any future one of these follow the same shape), returning
// the public URL. Does NOT record it on the album — the caller wraps that in its own
// optimistic-update/rollback (via `persist`), same as every other design setting.
async function uploadImageViaPresign(
  presignEndpoint: string,
  slug: string,
  file: File,
  maxEdge: number,
  maxBytes: number,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const prepared = await prepareDesignImage(file, maxEdge, maxBytes)
  if (!prepared.ok) return prepared
  const { blob, type: uploadType } = prepared

  const presignRes = await fetch(presignEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug,
      contentType: uploadType,
      fileName: file.name,
      fileSize: blob.size,
    }),
  })
  const presignBody = await jsonBody<{
    error?: string
    presignedUrl?: string
    publicUrl?: string
  }>(presignRes)
  if (!presignRes.ok || !presignBody.presignedUrl || !presignBody.publicUrl) {
    return { ok: false, error: presignBody.error ?? `Upload failed (${presignRes.status})` }
  }

  let putRes: Response
  try {
    putRes = await fetch(presignBody.presignedUrl, {
      method: 'PUT',
      body: blob,
      headers: {
        'Content-Type': uploadType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return { ok: false, error: 'Upload to storage failed (network error). Please try again.' }
  }
  if (!putRes.ok) {
    return { ok: false, error: `Upload to storage failed (${putRes.status})` }
  }

  return { ok: true, url: presignBody.publicUrl }
}

export function uploadHeaderImageFile(slug: string, file: File) {
  return uploadImageViaPresign('/api/album/header-image/upload', slug, file, DESIGN_IMAGE_MAX_EDGE, DESIGN_IMAGE_MAX_BYTES)
}

export function uploadLogoFile(slug: string, file: File) {
  return uploadImageViaPresign('/api/album/logo/upload', slug, file, LOGO_MAX_EDGE, LOGO_MAX_BYTES)
}

export async function saveLogoRequest(
  slug: string,
  url: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/album/logo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, logo_url: url }),
  })
  const body = await jsonBody<{ error?: string }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  return { ok: true }
}

export function uploadSponsorLogoFile(slug: string, file: File) {
  return uploadImageViaPresign('/api/album/sponsor-logo/upload', slug, file, LOGO_MAX_EDGE, LOGO_MAX_BYTES)
}

// Replace-whole-array: always send the complete desired list (see /api/album/sponsors).
export async function saveSponsorsRequest(
  slug: string,
  sponsors: SponsorLogo[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/album/sponsors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, sponsor_logos: sponsors }),
  })
  const body = await jsonBody<{ error?: string }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  return { ok: true }
}

export async function addAlbumToCollectionRequest(
  slug: string,
  collectionId: string,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const res = await fetch('/api/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, collection_id: collectionId }),
  })
  const body = await jsonBody<{ error?: string; collection?: { slug: string } }>(res)
  if (!res.ok || !body.collection) {
    return { ok: false, error: body.error ?? `Add failed (${res.status})` }
  }
  return { ok: true, slug: body.collection.slug }
}

export async function savePhotoLayoutRequest(
  slug: string,
  photoLayout: 'grid' | 'justified',
): Promise<{ ok: true; photo_layout: 'grid' | 'justified' } | { ok: false; error: string }> {
  const res = await fetch('/api/album/photo-layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, photo_layout: photoLayout }),
  })
  const body = await jsonBody<{ error?: string; photo_layout?: 'grid' | 'justified' }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  return { ok: true, photo_layout: body.photo_layout ?? photoLayout }
}

export async function saveGuestDownloadsRequest(
  slug: string,
  allowGuestDownloads: boolean,
): Promise<{ ok: true; allow_guest_downloads: boolean } | { ok: false; error: string }> {
  const res = await fetch('/api/album/guest-downloads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, allow_guest_downloads: allowGuestDownloads }),
  })
  const body = await jsonBody<{ error?: string; allow_guest_downloads?: boolean }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  return { ok: true, allow_guest_downloads: body.allow_guest_downloads ?? allowGuestDownloads }
}

export async function saveGuestUploadsRequest(
  slug: string,
  guestUploadsEnabled: boolean,
): Promise<{ ok: true; guest_uploads_enabled: boolean } | { ok: false; error: string }> {
  const res = await fetch('/api/album/guest-uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, guest_uploads_enabled: guestUploadsEnabled }),
  })
  const body = await jsonBody<{ error?: string; guest_uploads_enabled?: boolean }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  return { ok: true, guest_uploads_enabled: body.guest_uploads_enabled ?? guestUploadsEnabled }
}

// The composed slideshow transition saves on its own rather than riding along with the seven-field
// media-settings call: it is dragged continuously across six axes, and it must not be able to
// resend (or clobber) an unrelated setting on every tick. Same endpoint, partial body — the route
// only writes the fields it is given.
export async function saveSlideshowMotionRequest(
  slug: string,
  motion: SlideshowMotion | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/album/media-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, slideshow_motion: motion }),
  })
  const body = await jsonBody<{ error?: string }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  return { ok: true }
}

export async function saveRequireApprovalRequest(
  slug: string,
  requireApproval: boolean,
): Promise<{ ok: true; require_approval: boolean } | { ok: false; error: string }> {
  const res = await fetch('/api/album/media-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, require_approval: requireApproval }),
  })
  const body = await jsonBody<{ error?: string; require_approval?: boolean }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  return { ok: true, require_approval: body.require_approval ?? requireApproval }
}

export async function savePhotoHiddenRequest(
  slug: string,
  photoId: string,
  hidden: boolean,
): Promise<{ ok: true; hidden: boolean } | { ok: false; error: string }> {
  const res = await fetch('/api/album/photo/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, photo_id: photoId, hidden }),
  })
  const body = await jsonBody<{ error?: string; hidden?: boolean }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  return { ok: true, hidden: body.hidden ?? hidden }
}

export async function deleteAlbumRequest(
  slug: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/album/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  })
  const body = await jsonBody<{ error?: string }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Delete failed (${res.status})` }
  return { ok: true }
}

// Desktop columns save ALONE, deliberately.
//
// saveMediaSettingsRequest already threads seven positional settings; adding an eighth to every
// call site (radius drag, autoplay, filter, interval, animation) to carry one independent value
// is how that signature got to seven in the first place, and each new position is a chance to
// pass the arguments in the wrong order. The route updates only the fields present in the body,
// so this sends exactly the one that changed.
export async function saveDesktopGridColumns(
  slug: string,
  desktopGridColumns: number,
): Promise<{ ok: true; desktop_grid_columns: number } | { ok: false; error: string }> {
  const res = await fetch('/api/album/media-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, desktop_grid_columns: desktopGridColumns }),
  })
  const body = await jsonBody<{ error?: string; desktop_grid_columns?: number }>(res)
  if (!res.ok || body.desktop_grid_columns == null) {
    return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  }
  return { ok: true, desktop_grid_columns: body.desktop_grid_columns }
}

