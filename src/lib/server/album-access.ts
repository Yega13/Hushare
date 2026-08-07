import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyAccessToken } from '@/lib/album-password'
import { timingSafeEqual } from '@/lib/timing-safe'
import type { Album, Photo } from '@/types'

// Shared album access/gating logic — the SINGLE source of truth used by both the API routes
// (/api/album/resolve, /api/album/photos) and the server-rendered album page. Keeping the
// gating in one place guarantees the server render and the client-refetch path make identical
// owner/password/reveal decisions and can never drift out of sync.

// Minimal structural cookie type — accepts the result of `await cookies()` (next/headers)
// without coupling this module to that import, so it works from routes AND server components.
type CookieStore = { get(name: string): { value: string } | undefined }

const SLUG_RE = /^[a-z0-9-]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Mirrors the SELECT in the former resolve route. password_hash + retired_at are internal
// (stripped before returning); owner_token is fetched separately only when owner mode is asked.
const ALBUM_SELECT_COLS = [
  'id', 'slug', 'custom_slug', 'title', 'background_theme',
  'media_radius', 'media_filter', 'media_hover', 'mobile_grid_columns', 'photo_layout',
  'slideshow_interval_ms', 'slideshow_animation', 'video_autoplay',
  'cover_photo_id', 'reveal_at', 'guest_uploads_enabled', 'allow_guest_downloads',
  'require_approval', 'face_finder_enabled',
  'accent_color', 'logo_url', 'template', 'welcome_message', 'hide_branding',
  'last_activity_at', 'created_at',
  'password_hash', 'retired_at',
].join(', ')

// Same columns AlbumPageClient renders (mirrors the former photos route).
const PHOTO_SELECT_COLS = [
  'id', 'album_id', 'storage_path', 'storage_backend',
  'url', 'thumb_url', 'caption', 'author_name', 'created_at',
  'media_type', 'poster_url', 'stream_uid', 'stream_iframe_url',
  'stream_thumbnail_url', 'duration_seconds', 'width', 'height',
  'display_radius', 'display_filter', 'sort_order', 'face_ids', 'hidden',
].join(', ')

type AlbumRow = {
  id: string; slug: string; custom_slug: string | null; title: string
  background_theme: string | null; media_radius: number; media_filter: string
  media_hover: string; mobile_grid_columns: number; photo_layout: string
  slideshow_interval_ms: number; slideshow_animation: string; video_autoplay: boolean
  cover_photo_id: string | null; reveal_at: string | null; guest_uploads_enabled: boolean
  allow_guest_downloads: boolean; require_approval: boolean; face_finder_enabled: boolean
  accent_color: string | null; logo_url: string | null; template: string | null
  welcome_message: string | null; hide_branding: boolean
  last_activity_at: string; created_at: string
  password_hash: string | null; retired_at: string | null
}

// Fire-and-forget activity touch, throttled to once/hour (retirement only needs coarse recency).
// Uses waitUntil so the write survives past a streamed response on Workers; falls back to a bare
// floating promise in dev / where the execution context isn't available.
function touchActivity(admin: ReturnType<typeof createAdminClient>, albumId: string, lastActivityAt: string): void {
  const ageMs = Date.now() - new Date(lastActivityAt).getTime()
  if (Number.isFinite(ageMs) && ageMs <= 60 * 60 * 1000) return
  const p = admin.from('albums')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', albumId)
    .then(({ error }) => { if (error) console.error('[album-access] activity touch failed:', error.message) })
  try { getCloudflareContext().ctx.waitUntil(p as unknown as Promise<unknown>) } catch { void p }
}

export type ResolveResult =
  | { kind: 'invalid' }
  | { kind: 'notfound' }
  | { kind: 'reveal'; reveal_at: string; slug: string; title: string }
  | { kind: 'password'; slug: string; title: string }
  | { kind: 'album'; album: Album }

// Resolve a slug (random or custom) to an album, applying the reveal/password gates.
// wantsOwner=true (owner is in owner view via the #owner= link) bypasses the gates when a valid
// owner cookie is present. The server render always passes wantsOwner=false — it cannot read the
// URL fragment — so gated albums render their gate server-side and never leak photos into HTML.
export async function resolveAlbum(
  slugRaw: string,
  wantsOwner: boolean,
  cookieStore: CookieStore,
): Promise<ResolveResult> {
  const slug = (slugRaw ?? '').trim().toLowerCase()
  if (!slug || slug.length < 4 || slug.length > 80 || !SLUG_RE.test(slug)) {
    return { kind: 'invalid' }
  }

  const admin = createAdminClient()
  const { data: rows } = await admin.from('albums').select(ALBUM_SELECT_COLS)
    .or(`slug.eq.${slug},custom_slug.eq.${slug}`)
    .is('retired_at', null)
    .limit(2)
    .returns<AlbumRow[]>()
  const album: AlbumRow | null = rows && rows.length > 0
    ? (rows.find((r) => r.slug === slug) ?? rows[0])
    : null
  if (!album || album.retired_at) return { kind: 'notfound' }

  const albumId = album.id

  let isOwner = false
  const ownerCookieVal = (cookieStore.get(`hushare_owner_${albumId}`)?.value ?? '').trim()
  if (wantsOwner && ownerCookieVal) {
    const { data: ownerRow } = await admin
      .from('albums').select('owner_token').eq('id', albumId)
      .maybeSingle<{ owner_token: string }>()
    isOwner = !!ownerRow && timingSafeEqual(ownerCookieVal, ownerRow.owner_token)
  }

  if (!isOwner) {
    if (album.reveal_at && new Date(album.reveal_at) > new Date()) {
      return { kind: 'reveal', reveal_at: album.reveal_at, slug: album.slug, title: album.title }
    }
    if (album.password_hash) {
      const pwCookie = cookieStore.get(`hushare_pw_${albumId}`)?.value ?? ''
      const unlocked = pwCookie.length > 0
        ? await verifyAccessToken(pwCookie, album.password_hash, albumId)
        : false
      if (!unlocked) return { kind: 'password', slug: album.slug, title: album.title }
    }
  }

  touchActivity(admin, albumId, album.last_activity_at)

  const { password_hash: _pw, retired_at: _ra, ...publicAlbum } = album
  void _ra
  return { kind: 'album', album: { ...publicAlbum, password_protected: !!_pw } as unknown as Album }
}

export type PhotosResult =
  | { kind: 'invalid' }
  | { kind: 'notfound' }
  | { kind: 'reveal' }
  | { kind: 'password' }
  | { kind: 'ok'; photos: Photo[]; total?: number }

// Authorized photo listing. Anon RLS only exposes OPEN albums, so password/reveal-gated albums
// (and an owner's own view of them) are read here via the admin client AFTER verifying the caller
// is the owner (owner cookie) or an unlocked guest (password access-token cookie).
// Default page size for the full album view. Small albums (≤ this) fetch everything in one shot —
// exactly the pre-pagination behaviour. Only albums LARGER than this ever paginate.
export const ALBUM_PAGE_SIZE = 2000

export async function fetchAuthorizedPhotos(
  albumId: string,
  cookieStore: CookieStore,
  opts: { recentLimit?: number; offset?: number; limit?: number } = {},
): Promise<PhotosResult> {
  if (!UUID_RE.test(albumId)) return { kind: 'invalid' }

  const admin = createAdminClient()
  const { data: album } = await admin
    .from('albums')
    .select('id, owner_token, password_hash, reveal_at, retired_at')
    .eq('id', albumId)
    .maybeSingle<{ id: string; owner_token: string; password_hash: string | null; reveal_at: string | null; retired_at: string | null }>()

  if (!album || album.retired_at) return { kind: 'notfound' }

  const ownerCookie = (cookieStore.get(`hushare_owner_${albumId}`)?.value ?? '').trim()
  const isOwner = ownerCookie.length > 0 && timingSafeEqual(ownerCookie, album.owner_token)
  let authorized = isOwner

  if (!authorized) {
    if (album.reveal_at && new Date(album.reveal_at) > new Date()) return { kind: 'reveal' }
    if (album.password_hash) {
      const pwCookie = cookieStore.get(`hushare_pw_${albumId}`)?.value ?? ''
      authorized = pwCookie.length > 0
        ? await verifyAccessToken(pwCookie, album.password_hash, albumId)
        : false
      if (!authorized) return { kind: 'password' }
    } else {
      authorized = true
    }
  }

  // Moderation: the owner sees every photo (so they can review/approve); guests only see photos
  // that aren't hidden (pending approval, or hidden by the owner).
  const recent = opts.recentLimit && opts.recentLimit > 0 ? opts.recentLimit : null
  // Full-view paging window. Defaults (offset 0, limit ALBUM_PAGE_SIZE) reproduce the old
  // single-shot `.limit(2000)` exactly; callers only pass offset/limit for a big album's next page.
  const offset = Math.max(0, Math.floor(opts.offset ?? 0))
  const limit = Math.min(ALBUM_PAGE_SIZE, Math.max(1, Math.floor(opts.limit ?? ALBUM_PAGE_SIZE)))

  let query = admin.from('photos').select(PHOTO_SELECT_COLS).eq('album_id', albumId)
  if (!isOwner) query = query.eq('hidden', false)
  // recentLimit (the live wall): fetch only the newest N — the wall shows a bounded window, so
  // pulling the whole album on every refetch is pure waste on the always-on display device.
  query = recent
    ? query.order('created_at', { ascending: false }).limit(recent)
    // id is the deterministic tiebreaker: without it two photos sharing (sort_order, created_at)
    // could swap places between page fetches, so range() paging would skip/duplicate one. With it
    // the total order is stable, which is what makes offset paging correct.
    : query.order('sort_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + limit - 1)
  const { data: photos, error } = await query

  if (error) {
    console.error('[album-access] photos fetch failed:', error.message)
    throw new Error('photos_fetch_failed')
  }

  // Total drives the wall counter + the album's hasMore. Optimisation: if the full view returned
  // FEWER than a full page, we've reached the end — so total = offset + what we got, no count query
  // (the common small-album case). Only a full page (maybe more) or the wall needs a HEAD count.
  const got = photos?.length ?? 0
  let total: number
  if (!recent && got < limit) {
    total = offset + got
  } else {
    let countQuery = admin.from('photos').select('id', { count: 'exact', head: true }).eq('album_id', albumId)
    if (!isOwner) countQuery = countQuery.eq('hidden', false)
    const { count } = await countQuery
    total = count ?? offset + got
  }

  return { kind: 'ok', photos: (photos ?? []) as unknown as Photo[], total }
}
