import { NextResponse } from 'next/server'
import type { Database } from '@/types/database'
import { refuseAccess } from '@/lib/server/respond'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { refuseBelowTier } from '@/lib/require-tier'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { queueAlbumSettingsBroadcast } from '@/lib/broadcast'
import { normalizeSlideshowMotion } from '@/lib/slideshow-motion'

export const runtime = 'nodejs'

import { isMobileColumns, isDesktopColumns, resolveGridColumns, MOBILE_COLUMN_CHOICES, DESKTOP_COLUMN_CHOICES } from '@/lib/grid-columns'
import { isPhotoOrder, PHOTO_ORDER_CHOICES } from '@/lib/photo-order'

const NO_STORE = { 'Cache-Control': 'no-store' }

const VALID_FILTERS = new Set(['none', 'warm', 'cool', 'mono', 'vintage', 'soft'])

const VALID_SLIDESHOW_ANIMS = new Set(['none', 'fade', 'rise', 'zoom'])

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as {
    slug?: unknown
    media_radius?: unknown
    media_filter?: unknown
    mobile_grid_columns?: unknown
    desktop_grid_columns?: unknown
    photo_order?: unknown
    slideshow_interval_ms?: unknown
    slideshow_animation?: unknown
    slideshow_motion?: unknown
    video_autoplay?: unknown
    require_approval?: unknown
    reset_radius_overrides?: unknown
    reset_filter_overrides?: unknown
  } | null
  if (!body || typeof body.slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  // TYPED FROM THE SCHEMA, where this was `Record<string, unknown>`.
  //
  // An untyped patch is a patch nobody checks: `updates.acccent_color = x` compiled, PostgREST
  // answered 400, and the owner's save failed with no clue why. The generated Update type makes a
  // misspelled column a compile error and a wrong value type too.
  const updates: Database['public']['Tables']['albums']['Update'] = {}

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
  // Both column settings validate against lib/grid-columns.ts, the same module the toolbar
  // builds its buttons from and the grid renders with — so an accepted value is always an
  // offered value (rule 13; the old local Set had already drifted, allowing no 2-column phone
  // layout while claiming to own the range).
  if (body.mobile_grid_columns !== undefined) {
    if (!isMobileColumns(body.mobile_grid_columns)) {
      return NextResponse.json({ error: `mobile_grid_columns must be one of: ${MOBILE_COLUMN_CHOICES.join(', ')}` }, { status: 400, headers: NO_STORE })
    }
    updates.mobile_grid_columns = body.mobile_grid_columns
  }
  if (body.photo_order !== undefined) {
    // NO UI SENDS THIS. The owner-facing control was removed deliberately: newest-first is right
    // for essentially every album, dragging photos already covers anyone who wants a specific
    // arrangement, and one more switch in Settings is a worse trade than the preference is worth.
    // The field stays reachable here for support — a large album cannot realistically be dragged
    // into chronological order, so this is the only way to grant that if somebody ever asks.
    //
    // 'manual' is deliberately NOT settable here. An album becomes manual by being dragged into
    // an order (see photos/reorder); accepting it from a menu would claim an arrangement that
    // does not exist and leave every row's sort_order NULL — an album in no order at all.
    if (!isPhotoOrder(body.photo_order) || body.photo_order === 'manual') {
      return NextResponse.json({ error: `photo_order must be one of: ${PHOTO_ORDER_CHOICES.join(', ')}` }, { status: 400, headers: NO_STORE })
    }
    updates.photo_order = body.photo_order
  }
  if (body.desktop_grid_columns !== undefined) {
    if (!isDesktopColumns(body.desktop_grid_columns)) {
      return NextResponse.json({ error: `desktop_grid_columns must be one of: ${DESKTOP_COLUMN_CHOICES.join(', ')}` }, { status: 400, headers: NO_STORE })
    }
    updates.desktop_grid_columns = body.desktop_grid_columns
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
  if (body.slideshow_motion !== undefined) {
    // null is a legitimate value: it resets the album to deriving its transition from the legacy
    // preset. Anything else has to survive normalisation, which clamps every axis into range —
    // so a malformed body can never store a motion the renderer would choke on.
    if (body.slideshow_motion === null) {
      updates.slideshow_motion = null
    } else {
      const motion = normalizeSlideshowMotion(body.slideshow_motion)
      if (!motion) {
        return NextResponse.json({ error: 'slideshow_motion must be an object or null' }, { status: 400, headers: NO_STORE })
      }
      updates.slideshow_motion = motion
    }
  }
  if (body.video_autoplay !== undefined) {
    if (typeof body.video_autoplay !== 'boolean') {
      return NextResponse.json({ error: 'video_autoplay must be a boolean' }, { status: 400, headers: NO_STORE })
    }
    updates.video_autoplay = body.video_autoplay
  }
  if (body.require_approval !== undefined) {
    if (typeof body.require_approval !== 'boolean') {
      return NextResponse.json({ error: 'require_approval must be a boolean' }, { status: 400, headers: NO_STORE })
    }
    updates.require_approval = body.require_approval
  }

  const hasResetFlags = body.reset_radius_overrides === true || body.reset_filter_overrides === true
  if (Object.keys(updates).length === 0 && !hasResetFlags) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, body.slug.trim())
  if (!access.ok) return refuseAccess(access)

  // Moderation is gated per FIELD, not per route. Everything else this endpoint sets — slideshow
  // speed, autoplay, grid columns — is free, and refusing the whole request would take those away
  // from a free owner who happened to change two settings at once.
  //
  // Only turning it ON is checked. Turning it off must always work: a lapsed subscription must never
  // leave an album holding photos for approval that its owner can no longer reach.
  if (updates.require_approval === true) {
    const refusal = await refuseBelowTier(access.album, 'pro', 'Photo moderation')
    if (refusal) return refusal
  }

  const admin = createAdminClient()
  // PIN DESKTOP BEFORE MOVING THE PHONE, or one setting silently drags the other.
  //
  // An album with no desktop choice CARRIES its phone number to desktop, so nothing looked
  // rearranged when per-device columns shipped (see lib/grid-columns). The consequence nobody
  // saw: while desktop is unset the two ARE the same number, so an owner changing "photos per
  // row — phone" from 6 to 3 watched their desktop layout change with it. Reported exactly that
  // way, on the live event album.
  //
  // The carry only ever meant "preserve what this album already showed". The moment an owner
  // deliberately moves the phone setting, desktop stops following and keeps what it was
  // displaying. Written only when desktop has no value of its own, so an explicit choice is
  // never overwritten, and only alongside a phone change, so nothing else touches it.
  if (updates.mobile_grid_columns !== undefined && updates.desktop_grid_columns === undefined) {
    // Read rather than assume: the owner-access row is deliberately narrow and carries neither
    // column. One small query, and only when the phone setting is actually being changed.
    const { data: cur } = await admin
      .from('albums')
      .select('mobile_grid_columns, desktop_grid_columns')
      .eq('id', access.album.id)
      .maybeSingle<{ mobile_grid_columns: number | null; desktop_grid_columns: number | null }>()
    // A failed read leaves desktop alone. The old coupling is a cosmetic surprise; overwriting a
    // choice the owner made would be worse, and this is not worth guessing about.
    if (cur && !isDesktopColumns(cur.desktop_grid_columns)) {
      const carried = resolveGridColumns(cur).desktop
      if (isDesktopColumns(carried)) updates.desktop_grid_columns = carried
    }
  }

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

  queueAlbumSettingsBroadcast(access.album.id, updates)

  // Echo back the applied values so the client can synchronise its state. The client sends only
  // the fields that changed (undefined keys vanish in JSON), so this echo is the applied SUBSET —
  // the old comment claiming "always all 7 fields" described the bug, not a guarantee: posting
  // every field from local state is how a stale tab merged the phone and desktop grids.
  return NextResponse.json({
    ok: true,
    media_radius: updates.media_radius,
    video_autoplay: updates.video_autoplay,
    media_filter: updates.media_filter,
    mobile_grid_columns: updates.mobile_grid_columns,
    photo_order: updates.photo_order,
    desktop_grid_columns: updates.desktop_grid_columns,
    slideshow_interval_ms: updates.slideshow_interval_ms,
    slideshow_animation: updates.slideshow_animation,
    slideshow_motion: updates.slideshow_motion,
    require_approval: updates.require_approval,
  }, { headers: NO_STORE })
}
