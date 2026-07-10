import type { CollectionSummary } from '@/components/owner-toolbar/types'
import type { MediaDisplayFilter, MediaHoverEffect, MobileGridColumns, SlideshowAnimation } from '@/lib/media-display'

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

export async function saveMediaSettingsRequest(
  slug: string,
  mediaRadius: number,
  videoAutoplay: boolean,
  mediaFilter: MediaDisplayFilter,
  mediaHover: MediaHoverEffect,
  mobileGridColumns: MobileGridColumns,
  slideshowIntervalMs: number,
  slideshowAnimation: SlideshowAnimation,
  resetRadiusOverrides: boolean,
  resetFilterOverrides: boolean,
): Promise<{
  ok: true
  media_radius: number
  video_autoplay: boolean
  media_filter: MediaDisplayFilter
  media_hover: MediaHoverEffect
  mobile_grid_columns: MobileGridColumns
  slideshow_interval_ms: number
  slideshow_animation: SlideshowAnimation
} | { ok: false; error: string }> {
  const res = await fetch('/api/album/media-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug,
      media_radius: mediaRadius,
      video_autoplay: videoAutoplay,
      media_filter: mediaFilter,
      media_hover: mediaHover,
      mobile_grid_columns: mobileGridColumns,
      slideshow_interval_ms: slideshowIntervalMs,
      slideshow_animation: slideshowAnimation,
      reset_radius_overrides: resetRadiusOverrides,
      reset_filter_overrides: resetFilterOverrides,
    }),
  })
  const body = await jsonBody<{
    error?: string
    media_radius?: number
    video_autoplay?: boolean
    media_filter?: MediaDisplayFilter
    media_hover?: MediaHoverEffect
    mobile_grid_columns?: MobileGridColumns
    slideshow_interval_ms?: number
    slideshow_animation?: SlideshowAnimation
  }>(res)
  if (
    !res.ok ||
    body.media_radius == null ||
    body.video_autoplay == null ||
    !body.media_filter ||
    !body.media_hover ||
    !body.mobile_grid_columns ||
    body.slideshow_interval_ms == null ||
    !body.slideshow_animation
  ) {
    return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  }
  return {
    ok: true,
    media_radius: body.media_radius,
    video_autoplay: body.video_autoplay,
    media_filter: body.media_filter,
    media_hover: body.media_hover,
    mobile_grid_columns: body.mobile_grid_columns,
    slideshow_interval_ms: body.slideshow_interval_ms,
    slideshow_animation: body.slideshow_animation,
  }
}

export async function uploadBackgroundRequest(
  slug: string,
  file: File,
): Promise<{ ok: true; background_theme: string } | { ok: false; error: string }> {
  // Step 1: get a presigned PUT URL from the server
  const presignRes = await fetch('/api/album/background/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug,
      contentType: file.type,
      fileName: file.name,
      fileSize: file.size,
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

  // Step 2: PUT the file bytes directly to R2 via the presigned URL. Cache-Control must match
  // IMMUTABLE_CACHE_CONTROL in src/lib/cloudflare/r2.ts exactly — it's bound into the presigned
  // signature, so any mismatch is rejected by R2 as SignatureDoesNotMatch. Each background upload
  // gets a fresh uuid() key (see background/upload/route.ts), so caching it forever is safe.
  const putRes = await fetch(presignBody.presignedUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
      'Content-Length': String(file.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
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
