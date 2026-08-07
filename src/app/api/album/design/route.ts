import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { queueAlbumSettingsBroadcast } from '@/lib/broadcast'
import { getActiveSubscription } from '@/lib/subscriptions'
import { isValidHex, isPaletteColor, isDarkEnoughForWhiteText } from '@/lib/album-design'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Album design settings. Mirrors the auth/broadcast pattern of /api/album/media-settings.
// Step 2 handles accent_color only; later steps (welcome, logo, template) extend the same route.
export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; accent_color?: unknown } | null
  if (!body || typeof body.slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (body.accent_color === undefined) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400, headers: NO_STORE })
  }

  // null clears back to the default accent. A string must be a valid #rrggbb hex.
  let accent: string | null = null
  if (body.accent_color !== null) {
    if (typeof body.accent_color !== 'string' || !isValidHex(body.accent_color)) {
      return NextResponse.json({ error: 'accent_color must be a #rrggbb hex or null' }, { status: 400, headers: NO_STORE })
    }
    accent = body.accent_color.toLowerCase()
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, body.slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  // Palette colors are free for everyone. A custom (non-palette) color is a paid feature AND must
  // pass the darkness check so white button text stays readable. Gating is enforced HERE on the
  // server — never trust the client to have hidden the control.
  if (accent && !isPaletteColor(accent)) {
    const isPaid = access.userId ? (await getActiveSubscription(access.userId)) !== null : false
    if (!isPaid) {
      return NextResponse.json({ error: 'Custom colors are a paid feature — pick a palette color or upgrade.' }, { status: 403, headers: NO_STORE })
    }
    if (!isDarkEnoughForWhiteText(accent)) {
      return NextResponse.json({ error: 'That color is too light for readable buttons — please pick a darker shade.' }, { status: 400, headers: NO_STORE })
    }
  }

  const admin = createAdminClient()
  const { error } = await admin.from('albums').update({ accent_color: accent }).eq('id', access.album.id)
  if (error) {
    console.error('[album/design] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update design' }, { status: 500, headers: NO_STORE })
  }

  queueAlbumSettingsBroadcast(access.album.id, { accent_color: accent })
  return NextResponse.json({ ok: true, accent_color: accent }, { headers: NO_STORE })
}
