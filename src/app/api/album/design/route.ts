import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { queueAlbumSettingsBroadcast } from '@/lib/broadcast'
import { getActiveSubscription } from '@/lib/subscriptions'
import { isValidHex, isPaletteColor } from '@/lib/album-design'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Album design settings. Mirrors the auth/broadcast pattern of /api/album/media-settings.
// Step 2 handles accent_color only; later steps (welcome, logo, template) extend the same route.
export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; accent_color?: unknown; welcome_message?: unknown } | null
  if (!body || typeof body.slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  const updates: Record<string, unknown> = {}
  let accentNeedsPaidCheck: string | null = null

  // accent_color: null clears to default; a string must be a valid #rrggbb hex.
  if (body.accent_color !== undefined) {
    if (body.accent_color === null) {
      updates.accent_color = null
    } else if (typeof body.accent_color === 'string' && isValidHex(body.accent_color)) {
      const accent = body.accent_color.toLowerCase()
      updates.accent_color = accent
      if (!isPaletteColor(accent)) accentNeedsPaidCheck = accent
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

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, body.slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  // A custom (non-palette) color is a paid feature. No darkness restriction — the header text/logo
  // auto-contrast. Gating is enforced HERE on the server — never trust the client to have hidden it.
  if (accentNeedsPaidCheck) {
    const isPaid = access.userId ? (await getActiveSubscription(access.userId)) !== null : false
    if (!isPaid) {
      return NextResponse.json({ error: 'Custom colors are a paid feature — pick a palette color or upgrade.' }, { status: 403, headers: NO_STORE })
    }
  }

  const admin = createAdminClient()
  const { error } = await admin.from('albums').update(updates).eq('id', access.album.id)
  if (error) {
    console.error('[album/design] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update design' }, { status: 500, headers: NO_STORE })
  }

  queueAlbumSettingsBroadcast(access.album.id, updates)
  return NextResponse.json({ ok: true, ...updates }, { headers: NO_STORE })
}
