import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CAPTION_LEN = 30
const MAX_AUTHOR_LEN = 16
const VALID_FILTERS = new Set(['none', 'warm', 'cool', 'mono', 'vintage', 'soft'])

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as {
    slug?: unknown
    photo_id?: unknown
    caption?: unknown
    author_name?: unknown
    display_radius?: unknown
    display_filter?: unknown
  } | null

  if (!body || typeof body.slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (typeof body.photo_id !== 'string' || !UUID_RE.test(body.photo_id)) {
    return NextResponse.json({ error: 'Invalid photo_id' }, { status: 400, headers: NO_STORE })
  }

  const updates: Record<string, unknown> = {}

  if (body.caption !== undefined) {
    if (body.caption !== null && typeof body.caption !== 'string') {
      return NextResponse.json({ error: 'caption must be a string or null' }, { status: 400, headers: NO_STORE })
    }
    const cap = typeof body.caption === 'string' ? body.caption.trim() : null
    if (cap !== null && cap.length > MAX_CAPTION_LEN) {
      return NextResponse.json({ error: `caption exceeds ${MAX_CAPTION_LEN} characters` }, { status: 400, headers: NO_STORE })
    }
    updates.caption = cap || null
  }

  if (body.author_name !== undefined) {
    if (body.author_name !== null && typeof body.author_name !== 'string') {
      return NextResponse.json({ error: 'author_name must be a string or null' }, { status: 400, headers: NO_STORE })
    }
    const name = typeof body.author_name === 'string' ? body.author_name.trim() : null
    if (name !== null && name.length > MAX_AUTHOR_LEN) {
      return NextResponse.json({ error: `author_name exceeds ${MAX_AUTHOR_LEN} characters` }, { status: 400, headers: NO_STORE })
    }
    updates.author_name = name || null
  }

  if (body.display_radius !== undefined) {
    if (body.display_radius !== null) {
      const r = body.display_radius
      if (typeof r !== 'number' || !Number.isInteger(r) || r < 0 || r > 500) {
        return NextResponse.json({ error: 'display_radius must be an integer 0–500 or null' }, { status: 400, headers: NO_STORE })
      }
    }
    updates.display_radius = body.display_radius
  }

  if (body.display_filter !== undefined) {
    if (body.display_filter !== null && (typeof body.display_filter !== 'string' || !VALID_FILTERS.has(body.display_filter))) {
      return NextResponse.json({ error: `display_filter must be one of: ${[...VALID_FILTERS].join(', ')} or null` }, { status: 400, headers: NO_STORE })
    }
    updates.display_filter = body.display_filter
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, body.slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('photos')
    .update(updates)
    .eq('id', body.photo_id)
    .eq('album_id', access.album.id)
    .select('id, display_radius, display_filter, caption, author_name')

  if (error) {
    console.error('[photo/settings] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update photo settings' }, { status: 500, headers: NO_STORE })
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Photo not found in this album' }, { status: 404, headers: NO_STORE })
  }

  // Return the full current values from the DB row so the client always gets the correct
  // state — even for fields not included in this particular update.
  const row = data[0]
  return NextResponse.json({
    ok: true,
    display_radius: row.display_radius ?? null,
    display_filter: row.display_filter ?? null,
    caption: row.caption ?? null,
    author_name: row.author_name ?? null,
  }, { headers: NO_STORE })
}
