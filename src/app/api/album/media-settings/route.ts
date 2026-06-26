import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { broadcastAlbumSettings } from '@/lib/broadcast'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const VALID_FILTERS = new Set(['none', 'warm', 'cool', 'mono', 'vintage', 'soft'])
const VALID_HOVERS = new Set(['none', 'mono', 'fade', 'zoom', 'lift'])
const VALID_GRID_COLUMNS = new Set([3, 4, 5, 6])
const VALID_SLIDESHOW_ANIMS = new Set(['none', 'fade', 'rise', 'zoom'])

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as {
    slug?: unknown
    media_radius?: unknown
    media_filter?: unknown
    media_hover?: unknown
    mobile_grid_columns?: unknown
    slideshow_interval_ms?: unknown
    slideshow_animation?: unknown
    video_autoplay?: unknown
    reset_radius_overrides?: unknown
    reset_filter_overrides?: unknown
  } | null
  if (!body || typeof body.slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  const updates: Record<string, unknown> = {}

  if (body.media_radius !== undefined) {
    const r = body.media_radius
    if (typeof r !== 'number' || !Number.isInteger(r) || r < 0 || r > 500) {
      return NextResponse.json({ error: 'media_radius must be an integer 0–500' }, { status: 400, headers: NO_STORE })
    }
    updates.media_radius = r
  }
  if (body.media_filter !== undefined) {
    if (typeof body.media_filter !== 'string' || !VALID_FILTERS.has(body.media_filter)) {
      return NextResponse.json({ error: `media_filter must be one of: ${[...VALID_FILTERS].join(', ')}` }, { status: 400, headers: NO_STORE })
    }
    updates.media_filter = body.media_filter
  }
  if (body.media_hover !== undefined) {
    if (typeof body.media_hover !== 'string' || !VALID_HOVERS.has(body.media_hover)) {
      return NextResponse.json({ error: `media_hover must be one of: ${[...VALID_HOVERS].join(', ')}` }, { status: 400, headers: NO_STORE })
    }
    updates.media_hover = body.media_hover
  }
  if (body.mobile_grid_columns !== undefined) {
    if (typeof body.mobile_grid_columns !== 'number' || !VALID_GRID_COLUMNS.has(body.mobile_grid_columns)) {
      return NextResponse.json({ error: `mobile_grid_columns must be one of: ${[...VALID_GRID_COLUMNS].join(', ')}` }, { status: 400, headers: NO_STORE })
    }
    updates.mobile_grid_columns = body.mobile_grid_columns
  }
  if (body.slideshow_interval_ms !== undefined) {
    const ms = body.slideshow_interval_ms
    if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 2000 || ms > 10000) {
      return NextResponse.json({ error: 'slideshow_interval_ms must be an integer 2000–10000' }, { status: 400, headers: NO_STORE })
    }
    updates.slideshow_interval_ms = ms
  }
  if (body.slideshow_animation !== undefined) {
    if (typeof body.slideshow_animation !== 'string' || !VALID_SLIDESHOW_ANIMS.has(body.slideshow_animation)) {
      return NextResponse.json({ error: `slideshow_animation must be one of: ${[...VALID_SLIDESHOW_ANIMS].join(', ')}` }, { status: 400, headers: NO_STORE })
    }
    updates.slideshow_animation = body.slideshow_animation
  }
  if (body.video_autoplay !== undefined) {
    if (typeof body.video_autoplay !== 'boolean') {
      return NextResponse.json({ error: 'video_autoplay must be a boolean' }, { status: 400, headers: NO_STORE })
    }
    updates.video_autoplay = body.video_autoplay
  }

  const hasResetFlags = body.reset_radius_overrides === true || body.reset_filter_overrides === true
  if (Object.keys(updates).length === 0 && !hasResetFlags) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, body.slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  const admin = createAdminClient()
  const { error } = await admin.from('albums').update(updates).eq('id', access.album.id)
  if (error) {
    console.error('[album/media-settings] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update settings' }, { status: 500, headers: NO_STORE })
  }

  // Clear per-photo overrides when the owner explicitly changes the album-level setting.
  if (body.reset_radius_overrides === true) {
    const { error: rErr } = await admin.from('photos').update({ display_radius: null }).eq('album_id', access.album.id)
    if (rErr) console.error('[album/media-settings] reset_radius_overrides failed:', rErr.message)
  }
  if (body.reset_filter_overrides === true) {
    const { error: fErr } = await admin.from('photos').update({ display_filter: null }).eq('album_id', access.album.id)
    if (fErr) console.error('[album/media-settings] reset_filter_overrides failed:', fErr.message)
  }

  void broadcastAlbumSettings(access.album.id, updates)

  // Echo back the applied values so the client can synchronise its state.
  // OwnerToolbar always sends all 7 fields, so updates always contains every key.
  return NextResponse.json({
    ok: true,
    media_radius: updates.media_radius,
    video_autoplay: updates.video_autoplay,
    media_filter: updates.media_filter,
    media_hover: updates.media_hover,
    mobile_grid_columns: updates.mobile_grid_columns,
    slideshow_interval_ms: updates.slideshow_interval_ms,
    slideshow_animation: updates.slideshow_animation,
  }, { headers: NO_STORE })
}
