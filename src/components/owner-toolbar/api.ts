import type { NumberTally } from '@/lib/bib-exclusions'
import type { CollectionSummary } from '@/components/owner-toolbar/types'
import type { MediaDisplayFilter, MobileGridColumns, SlideshowAnimation } from '@/lib/media-display'
import type { SponsorLogo, SlideshowMotion } from '@/types'
import { readFileRobust } from '@/lib/file-read'
import { afterInFlight } from '@/lib/inflight-gate'
import { isNetworkFailure } from '@/lib/network-failure'
import { IMMUTABLE_CACHE_CONTROL } from '@/lib/media'

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
/**
 * A save that did not get an answer: the fetch rejected (dead connection, or the 15 s bound below).
 * `network: true` tells the caller to show its translated network line rather than the browser's
 * own text. The media saver lets the rejection through to its caller's catch, which reverts the
 * draft; the two savers below turn it into this, because their callers only ever read `ok`.
 */
export type NetworkRefusal = { ok: false; error: string; network: true }
function networkRefusal(e: unknown): NetworkRefusal {
  return { ok: false, error: e instanceof Error ? e.message : String(e), network: true }
}
export { isNetworkFailure }

/** What the route says it wrote: the fields sent, plus a desktop pin it may add on its own. */
export type MediaSettingsApplied = MediaSettingsChanges & { desktop_grid_columns?: number }

/**
 * How long one settings write may stay out before it is given up on. A bare fetch on a dead
 * connection waits for the operating system to give up, and while it waits the album's wire
 * (below) is held: every later edit sits in a draft with no request, no toast and no error line,
 * and closing Settings no longer helps. Rule 25: a wait that hides an outcome is bounded. The
 * cost of the bound is the one the gate exists to remove -- a request abandoned here may still
 * reach the database after the next one -- so it is long enough that only a dead network hits it.
 */
export const MEDIA_SAVE_TIMEOUT_MS = 15_000

/**
 * EVERY write to /api/album/media-settings goes through here: the three savers (media settings,
 * desktop columns, slideshow motion) all update the same album row, and the route READS that row
 * on a phone-grid change to pin the desktop grid. Two of them on the wire at once can land in
 * either order, so a request for an album waits for every earlier request for that album
 * (lib/inflight-gate) -- across panel instances, which is why this is not in the component.
 */
async function postMediaSettings(slug: string, fields: Record<string, unknown>): Promise<Response> {
  // The bound starts when the request LEAVES, inside the run: a request queued behind a slow one
  // must not time out before it was ever sent. So on a dead network the album's wire is held for
  // one bound per queued request -- the motion sliders queue one per pause in a drag -- which is
  // long, but bounded by what the owner did, and every one of them is answered with a toast.
  return afterInFlight(slug, () => fetch('/api/album/media-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, ...fields }),
    signal: AbortSignal.timeout(MEDIA_SAVE_TIMEOUT_MS),
  }))
}

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
): Promise<{ ok: true; applied: MediaSettingsApplied } | { ok: false; error: string }> {
  const res = await postMediaSettings(slug, {
    ...changes,
    reset_radius_overrides: resetRadiusOverrides,
    reset_filter_overrides: resetFilterOverrides,
  })
  const body = await jsonBody<{ error?: string } & MediaSettingsApplied>(res)
  if (!res.ok) {
    return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  }
  // The route echoes back exactly the fields it applied; undefined keys vanish in JSON, so what
  // arrives is the applied subset and nothing else. desktop_grid_columns is the one field that can
  // come back WITHOUT being sent: a phone-grid change on an album that never chose a desktop
  // number pins the desktop grid to what it was showing (the route's carry), and the album has to
  // learn that or the desktop grid here follows the new phone number until the next refetch.
  const applied: MediaSettingsApplied = {}
  if (body.desktop_grid_columns !== undefined) applied.desktop_grid_columns = body.desktop_grid_columns
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

  // Step 2: PUT the in-memory blob to R2 via the presigned URL. Cache-Control is bound into the
  // presigned signature, so it must be byte-identical to what the server signed — both sides import
  // the one definition in lib/media (this used to be a retyped literal with a comment asking it to
  // match). Each background upload gets a fresh uuid() key, so caching it forever is safe.
  // (Content-Length is set automatically by the browser from the blob; setting it manually is a
  // no-op — it's a forbidden header — and the raw-File read is what actually used to fail.)
  let putRes: Response
  try {
    putRes = await fetch(presignBody.presignedUrl, {
      method: 'PUT',
      body: blob,
      headers: {
        'Content-Type': uploadType,
        'Cache-Control': IMMUTABLE_CACHE_CONTROL,
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
        'Cache-Control': IMMUTABLE_CACHE_CONTROL,
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
): Promise<{ ok: true } | { ok: false; error: string; network?: true }> {
  let res: Response
  try {
    res = await postMediaSettings(slug, { slideshow_motion: motion })
  } catch (e) {
    // A timed-out or unreachable save used to reject past the caller's .then: no toast, and an
    // unhandled rejection in the admin panel.
    return networkRefusal(e)
  }
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

// Deleting no longer destroys anything: the album is hidden immediately and its files are kept for
// a recovery window (lib/album-bin). The window comes back from the server rather than being
// repeated here, so the number the owner is shown is the number actually enforced (rule 13).
export async function deleteAlbumRequest(
  slug: string,
): Promise<{ ok: true; restorableForDays: number } | { ok: false; error: string }> {
  const res = await fetch('/api/album/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  })
  const body = await jsonBody<{ error?: string; restorableForDays?: number }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Delete failed (${res.status})` }
  return { ok: true, restorableForDays: body.restorableForDays ?? 0 }
}

// Put a deleted album back. Proof is the owner cookie the browser still holds — the delete path
// deliberately keeps it, because it is the only thing that can authorise this.
export async function restoreAlbumRequest(
  slug: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/album/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  })
  const body = await jsonBody<{ error?: string }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Restore failed (${res.status})` }
  return { ok: true }
}

// Start a Polar checkout for this album's package or renewal. The server requires BOTH the owner
// cookie and a signed-in account; a 401 with code sign_in_required is a normal outcome for a
// signed-out owner, and the caller turns it into a sign-in redirect rather than an error toast.
export async function startPackageCheckoutRequest(
  slug: string,
  item: 'package_pro' | 'package_max' | 'renewal_pro' | 'renewal_max',
): Promise<{ ok: true; url: string } | { ok: false; error: string; signInRequired: boolean }> {
  const res = await fetch('/api/checkout/package', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, item }),
  })
  const body = await jsonBody<{ error?: string; code?: string; url?: string }>(res)
  if (!res.ok || !body.url) {
    return {
      ok: false,
      error: body.error ?? `Checkout failed (${res.status})`,
      signInRequired: body.code === 'sign_in_required',
    }
  }
  return { ok: true, url: body.url }
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
): Promise<{ ok: true; desktop_grid_columns: number } | { ok: false; error: string; network?: true }> {
  let res: Response
  try {
    res = await postMediaSettings(slug, { desktop_grid_columns: desktopGridColumns })
  } catch (e) {
    return networkRefusal(e)   // see saveSlideshowMotionRequest
  }
  const body = await jsonBody<{ error?: string; desktop_grid_columns?: number }>(res)
  if (!res.ok || body.desktop_grid_columns == null) {
    return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  }
  return { ok: true, desktop_grid_columns: body.desktop_grid_columns }
}


export async function saveRevealRequest(
  slug: string,
  reveal_at: string | null,
): Promise<{ ok: true; reveal_at: string | null } | { ok: false; error: string }> {
  const res = await fetch('/api/album/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, reveal_at }),
  })
  const body = await jsonBody<{ ok?: boolean; reveal_at?: string | null; error?: string }>(res)
  if (!res.ok || !body.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  return { ok: true, reveal_at: body.reveal_at ?? null }
}

export async function saveBrandingRequest(
  slug: string,
  hideBranding: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/album/branding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, hide_branding: hideBranding }),
  })
  if (!res.ok) {
    const body = await jsonBody<{ error?: string }>(res)
    return { ok: false, error: body.error ?? 'Could not save' }
  }
  return { ok: true }
}

// The server refuses an enable without `consent`, so the dialog cannot be skipped by anyone
// calling the endpoint directly. Turning it OFF sends no consent field, as before.
export async function saveFaceFinderRequest(
  slug: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/album/face-finder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, enabled, consent: enabled ? true : undefined }),
  })
  if (!res.ok) {
    const body = await jsonBody<{ error?: string }>(res)
    return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  }
  return { ok: true }
}

export async function saveBibSearchRequest(
  slug: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/album/bib-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, enabled }),
  })
  if (!res.ok) {
    const body = await jsonBody<{ error?: string }>(res)
    return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  }
  return { ok: true }
}

// THE OWNER'S SIGNAGE LIST. GET offers the album's most-seen numbers with their photo counts and
// one photograph each, already ranked -- lib/bib-exclusions owns that decision and has tests, so
// nothing here re-sorts or re-filters.
//
// TWO FIELDS, TWO JOBS. `rows` is everything on screen, INCLUDING what is already excluded, so a
// wrong exclusion can be seen and undone. `excluded` is what the album has stored, and is what
// gets posted back; it is the write path and the row list is the read path.
// THE SHAPE COMES FROM lib/bib-exclusions, not a second copy of it here. It was written out again
// -- {number, photos} -- and the moment the tally gained a sample thumbnail the two disagreed and
// the panel could not read a field the server was already sending (rule 13).
export type BibExclusionsView = {
  rows: NumberTally[]
  excluded: string[]
}

export async function fetchBibExclusions(slug: string): Promise<BibExclusionsView | null> {
  try {
    const res = await fetch(`/api/album/bib-exclusions?slug=${encodeURIComponent(slug)}`)
    if (!res.ok) return null
    // A 200 IS NOT A SHAPE. The panel reads `rows.length` during render, so a body without it --
    // an interception page, a truncated response, or a browser still holding the bundle from
    // before this field was renamed -- throws inside React. Nothing here mounts ErrorBoundary, so
    // that throw reaches app/error.tsx and replaces the owner's whole ALBUM PAGE with an error
    // screen, over a dropdown they may not even have opened deliberately.
    //
    // An unusable body is "could not ask", the same as a network failure, and never an album with
    // no signage (rule 20).
    const body = await res.json() as Partial<BibExclusionsView> | null
    if (!body || !Array.isArray(body.rows) || !Array.isArray(body.excluded)) return null
    return { rows: body.rows, excluded: body.excluded }
  } catch {
    // Null is "could not ask", NOT "this album has no signage". The panel must tell those apart:
    // an empty list is a claim about the album and a failure is not (rule 20).
    return null
  }
}

// THE WHOLE LIST, NEVER A DELTA. The route replaces rather than merges, so posting one number
// would drop every other exclusion the owner has made.
export async function saveBibExclusionsRequest(
  slug: string,
  excluded: string[],
): Promise<{ ok: true; excluded: string[] } | { ok: false; error: string }> {
  const res = await fetch('/api/album/bib-exclusions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, excluded }),
  })
  const body = await jsonBody<{ error?: string; excluded?: string[] }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  // The SERVER's normalised list, not what was posted: it canonicalises 02026 to 2026, and the
  // panel has to show what was actually stored or the next save sends back a stale set.
  return { ok: true, excluded: body.excluded ?? excluded }
}
