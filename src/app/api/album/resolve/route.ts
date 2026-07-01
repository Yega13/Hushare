import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
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
  slideshow_interval_ms: number
  slideshow_animation: string
  video_autoplay: boolean
  cover_photo_id: string | null
  reveal_at: string | null
  guest_uploads_enabled: boolean
  allow_guest_downloads: boolean
  last_activity_at: string
  created_at: string
  // Internal — stripped before response
  password_hash: string | null
  retired_at: string | null
}

const SELECT_COLS = [
  'id', 'slug', 'custom_slug', 'title', 'background_theme',
  'media_radius', 'media_filter', 'media_hover', 'mobile_grid_columns',
  'slideshow_interval_ms', 'slideshow_animation', 'video_autoplay',
  'cover_photo_id', 'reveal_at', 'guest_uploads_enabled', 'allow_guest_downloads',
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

  // Owner check: owner_token is fetched in a separate minimal query ONLY when an owner
  // cookie is present. This means owner_token never enters memory on ordinary guest
  // requests, eliminating accidental leak risk from the main query path.
  let isOwner = false
  const ownerCookieVal = (cookieStore.get(`hushare_owner_${albumId}`)?.value ?? '').trim()
  if (ownerCookieVal) {
    const { data: ownerRow } = await admin
      .from('albums')
      .select('owner_token')
      .eq('id', albumId)
      .maybeSingle<{ owner_token: string }>()
    isOwner = !!ownerRow && timingSafeEqual(ownerCookieVal, ownerRow.owner_token)
  }

  // Account-based owner: a logged-in user whose account created this album gets owner
  // management access on ANY device — no owner link/cookie required. Verified server-side
  // against album.user_id, then we set the HttpOnly owner cookie so the toolbar and every
  // owner mutation route (all cookie-verified) recognize them. The getUser() round-trip is
  // only paid when a Supabase auth cookie is actually present (i.e. someone is logged in).
  let ownerTokenToSet: string | null = null
  if (!isOwner && cookieStore.getAll().some(c => c.name.startsWith('sb-') && c.name.includes('auth-token'))) {
    try {
      const supabase = await createServerSupabase()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: ownerRow } = await admin
          .from('albums')
          .select('user_id, owner_token')
          .eq('id', albumId)
          .maybeSingle<{ user_id: string | null; owner_token: string }>()
        if (ownerRow?.user_id && ownerRow.user_id === user.id) {
          isOwner = true
          ownerTokenToSet = ownerRow.owner_token
        }
      }
    } catch (e) {
      console.error('[resolve] account-owner check failed:', e instanceof Error ? e.message : String(e))
    }
  }

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
  const response = NextResponse.json(
    { ...publicAlbum, password_protected: !!_pw, account_owner: ownerTokenToSet !== null },
    { headers: NO_STORE },
  )
  // Grant owner access to the verified account owner by setting the HttpOnly owner cookie.
  // owner_token is never placed in the response body — only in this HttpOnly cookie.
  if (ownerTokenToSet) {
    response.cookies.set(`hushare_owner_${albumId}`, ownerTokenToSet, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
  }
  return response
}
