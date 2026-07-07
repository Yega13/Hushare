import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { verifyAccessToken } from '@/lib/album-password'
import { timingSafeEqual } from '@/lib/timing-safe'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// owner_token and user_id are intentionally absent — they are never needed in the
// resolve response. owner_token is fetched in a separate query only when an owner
// cookie is present, so it never touches memory on ordinary guest requests.
type AlbumRow = {
  id: string
  slug: string
  custom_slug: string | null
  title: string
  background_theme: string | null
  media_radius: number
  media_filter: string
  media_hover: string
  mobile_grid_columns: number
  photo_layout: string
  slideshow_interval_ms: number
  slideshow_animation: string
  video_autoplay: boolean
  cover_photo_id: string | null
  reveal_at: string | null
  guest_uploads_enabled: boolean
  allow_guest_downloads: boolean
  face_finder_enabled: boolean
  last_activity_at: string
  created_at: string
  // Internal — stripped before response
  password_hash: string | null
  retired_at: string | null
}

const SELECT_COLS = [
  'id', 'slug', 'custom_slug', 'title', 'background_theme',
  'media_radius', 'media_filter', 'media_hover', 'mobile_grid_columns', 'photo_layout',
  'slideshow_interval_ms', 'slideshow_animation', 'video_autoplay',
  'cover_photo_id', 'reveal_at', 'guest_uploads_enabled', 'allow_guest_downloads',
  'face_finder_enabled',
  'last_activity_at', 'created_at',
  'password_hash', 'retired_at',
].join(', ')

export async function GET(req: Request) {
  const url = new URL(req.url)
  const slug = (url.searchParams.get('slug') ?? '').trim().toLowerCase()

  if (!slug || slug.length < 4 || slug.length > 80 || !/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400, headers: NO_STORE })
  }

  // failOpen:true intentionally — album/resolve is a read-only endpoint and failing it closed
  // would make all album views return 429 during any rate-limit store outage, which is worse
  // than allowing slug enumeration to continue until the store recovers.
  const rl = await checkRateLimit(clientIpKey(req, 'album_resolve'), 60, 30, { failOpen: true })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const admin = createAdminClient()

  // Random slug takes priority over custom_slug in case of string overlap.
  // Filter retired_at at SQL level — JS check below is belt-and-suspenders only.
  let album: AlbumRow | null = null
  const { data: bySlug } = await admin.from('albums').select(SELECT_COLS).eq('slug', slug).is('retired_at', null).maybeSingle<AlbumRow>()
  if (bySlug) {
    album = bySlug
  } else {
    const { data: byCustom } = await admin.from('albums').select(SELECT_COLS).eq('custom_slug', slug).is('retired_at', null).maybeSingle<AlbumRow>()
    album = byCustom
  }

  if (!album || album.retired_at) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }

  const albumId = album.id
  const cookieStore = await cookies()

  // Owner check: the client passes owner=1 only when it is actually in owner view (the
  // #owner= management link is in the URL this load). A leftover owner cookie on the plain
  // (guest) URL must NOT be treated as owner — otherwise the reveal/password gates would be
  // silently bypassed for a guest-looking view. owner_token is fetched in a separate minimal
  // query ONLY when owner mode is requested and a cookie is present, so it never enters memory
  // on ordinary guest requests.
  const wantsOwner = url.searchParams.get('owner') === '1'
  let isOwner = false
  const ownerCookieVal = (cookieStore.get(`hushare_owner_${albumId}`)?.value ?? '').trim()
  if (wantsOwner && ownerCookieVal) {
    const { data: ownerRow } = await admin
      .from('albums')
      .select('owner_token')
      .eq('id', albumId)
      .maybeSingle<{ owner_token: string }>()
    isOwner = !!ownerRow && timingSafeEqual(ownerCookieVal, ownerRow.owner_token)
  }

  // Owner status is determined ONLY by the owner cookie above. Account identity does NOT
  // auto-grant owner access here: the public album URL is a guest experience for everyone,
  // including the logged-in creator. The creator gets owner access by opening their
  // management link (from the account dashboard), which sets the owner cookie.
  if (!isOwner) {
    // Reveal gate
    if (album.reveal_at && new Date(album.reveal_at) > new Date()) {
      return NextResponse.json({
        reveal_at: album.reveal_at,
        locked: true,
        slug: album.slug,
        title: album.title,
      }, { headers: NO_STORE })
    }

    // Password gate
    if (album.password_hash) {
      const pwCookie = cookieStore.get(`hushare_pw_${albumId}`)?.value ?? ''
      const unlocked = pwCookie.length > 0
        ? await verifyAccessToken(pwCookie, album.password_hash, albumId)
        : false
      if (!unlocked) {
        return NextResponse.json({
          password_required: true,
          slug: album.slug,
          title: album.title,
        }, { headers: NO_STORE })
      }
    }
  }

  // Fire-and-forget activity touch — errors are non-fatal, log and continue
  void admin.from('albums')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', albumId)
    .then(({ error }) => {
      if (error) console.error('[resolve] activity touch failed:', error.message)
    })

  // Strip internal columns — password_hash and retired_at are never sent to the client
  const { password_hash: _pw, retired_at: _ra, ...publicAlbum } = album
  return NextResponse.json(
    { ...publicAlbum, password_protected: !!_pw },
    { headers: NO_STORE },
  )
}
