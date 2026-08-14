import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { queueAlbumSettingsBroadcast } from '@/lib/broadcast'
import { isValidHex, isValidFont, getTemplate, isValidPhotoStyle, isValidHeaderVideoMode } from '@/lib/album-design'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Album design settings — text/enum fields only (accent_color, welcome_message, title_font,
// template, photo_style). Fields backed by an R2-hosted image get their own dedicated route
// instead (see /api/album/background, /api/album/header-image, /api/album/logo) since those need
// upload presigning and old-object cleanup that a shared text-field route has no business doing.
export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; accent_color?: unknown; welcome_message?: unknown; title_font?: unknown; template?: unknown; photo_style?: unknown; header_focal?: unknown; header_zoom?: unknown; header_video_mode?: unknown } | null
  if (!body || typeof body.slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  const updates: Record<string, unknown> = {}

  // accent_color: null clears to default; a string must be a valid #rrggbb hex.
  // NOTE: custom (non-palette) colours were gated to paid tiers. Gating is deliberately OFF while
  // we get every design feature working end-to-end; revisit pricing once the feature set settles.
  if (body.accent_color !== undefined) {
    if (body.accent_color === null) {
      updates.accent_color = null
    } else if (typeof body.accent_color === 'string' && isValidHex(body.accent_color)) {
      updates.accent_color = body.accent_color.toLowerCase()
    } else {
      return NextResponse.json({ error: 'accent_color must be a #rrggbb hex or null' }, { status: 400, headers: NO_STORE })
    }
  }

  // welcome_message: a short line shown in the header; empty → cleared to null.
  if (body.welcome_message !== undefined) {
    if (body.welcome_message !== null && typeof body.welcome_message !== 'string') {
      return NextResponse.json({ error: 'welcome_message must be a string or null' }, { status: 400, headers: NO_STORE })
    }
    const wm = typeof body.welcome_message === 'string' ? body.welcome_message.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
    updates.welcome_message = wm || null
  }

  // title_font: null clears to the default classic serif; a string must be a known font key.
  if (body.title_font !== undefined) {
    if (body.title_font === null) {
      updates.title_font = null
    } else if (typeof body.title_font === 'string' && isValidFont(body.title_font)) {
      updates.title_font = body.title_font
    } else {
      return NextResponse.json({ error: 'title_font must be a known font or null' }, { status: 400, headers: NO_STORE })
    }
  }

  // photo_style: null / 'default' clears to the default look; else a known style key.
  if (body.photo_style !== undefined) {
    if (body.photo_style === null || body.photo_style === 'default') {
      updates.photo_style = null
    } else if (typeof body.photo_style === 'string' && isValidPhotoStyle(body.photo_style)) {
      updates.photo_style = body.photo_style
    } else {
      return NextResponse.json({ error: 'photo_style must be a known style or null' }, { status: 400, headers: NO_STORE })
    }
  }

  // template: apply a one-tap "look" — sets accent, title font, and layout together in one write.
  // All preset accents are palette colours, so this is always free (no paid-colour check needed).
  if (body.template !== undefined) {
    if (body.template === null) {
      updates.template = null
    } else if (typeof body.template === 'string') {
      const preset = getTemplate(body.template)
      if (!preset) {
        return NextResponse.json({ error: 'Unknown template' }, { status: 400, headers: NO_STORE })
      }
      updates.template = preset.key
      updates.accent_color = preset.accent
      updates.title_font = preset.font
      updates.photo_layout = preset.layout
    } else {
      return NextResponse.json({ error: 'template must be a preset key or null' }, { status: 400, headers: NO_STORE })
    }
  }

  // header_focal: where the header photo/video is anchored in the hero crop, "X% Y%" (0-100 each).
  // null clears to the default center crop.
  if (body.header_focal !== undefined) {
    if (body.header_focal === null) {
      updates.header_focal = null
    } else if (typeof body.header_focal === 'string' && /^(?:100|[1-9]?\d)% (?:100|[1-9]?\d)%$/.test(body.header_focal)) {
      updates.header_focal = body.header_focal
    } else {
      return NextResponse.json({ error: 'header_focal must be an "X% Y%" position or null' }, { status: 400, headers: NO_STORE })
    }
  }

  // header_zoom: how far the header photo is zoomed, as a % of cover size. 100 = no zoom.
  // Clamped to a sane range so a bad value can't blow the banner up to an unusable scale.
  if (body.header_zoom !== undefined) {
    if (body.header_zoom === null) {
      updates.header_zoom = null
    } else if (typeof body.header_zoom === 'number' && Number.isFinite(body.header_zoom)) {
      const z = Math.round(body.header_zoom)
      if (z < 100 || z > 300) {
        return NextResponse.json({ error: 'header_zoom must be between 100 and 300' }, { status: 400, headers: NO_STORE })
      }
      updates.header_zoom = z
    } else {
      return NextResponse.json({ error: 'header_zoom must be a number or null' }, { status: 400, headers: NO_STORE })
    }
  }

  // header_video_mode: how a video used as the header plays. null clears to the default ('loop').
  if (body.header_video_mode !== undefined) {
    if (body.header_video_mode === null) {
      updates.header_video_mode = null
    } else if (typeof body.header_video_mode === 'string' && isValidHeaderVideoMode(body.header_video_mode)) {
      updates.header_video_mode = body.header_video_mode
    } else {
      return NextResponse.json({ error: 'header_video_mode must be a known mode or null' }, { status: 400, headers: NO_STORE })
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, body.slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  const admin = createAdminClient()
  const { error } = await admin.from('albums').update(updates).eq('id', access.album.id)
  if (error) {
    console.error('[album/design] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update design' }, { status: 500, headers: NO_STORE })
  }

  queueAlbumSettingsBroadcast(access.album.id, updates)
  return NextResponse.json({ ok: true, ...updates }, { headers: NO_STORE })
}
