import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const SLUG_RE = /^[a-z0-9-]{1,64}$/
const MAX_SLUGS = 60

// Which of these albums still exist? "Your albums on this device" is rebuilt from localStorage,
// which has no idea an album was deleted somewhere else — from the owner toolbar, on another
// device, or by the retention job. Those entries lingered as ghosts the owner could not get rid
// of: tapping Delete on an already-deleted album is a no-op, so the list only ever grew.
//
// Discloses nothing new: anyone can already tell a slug exists by requesting the album URL and
// seeing 200 vs 404. Returns ONLY the subset asked about, so it can't be used to enumerate.
export async function POST(req: Request) {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  // failOpen: a limiter blip must not make the list prune everything it can't verify.
  const rl = await checkRateLimit(clientIpKey(req, 'album_exists'), 60, 30, { failOpen: true })
  if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: NO_STORE })

  const body = await req.json().catch(() => null) as { slugs?: unknown } | null
  const raw = Array.isArray(body?.slugs) ? body.slugs : []
  const slugs = raw
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => SLUG_RE.test(s))
    .slice(0, MAX_SLUGS)

  if (slugs.length === 0) return NextResponse.json({ alive: [] }, { headers: NO_STORE })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('albums')
    .select('slug, custom_slug')
    .or(`slug.in.(${slugs.join(',')}),custom_slug.in.(${slugs.join(',')})`)
    .is('retired_at', null)
    .returns<{ slug: string; custom_slug: string | null }[]>()

  if (error) {
    // On failure report everything as alive. Pruning on an error would delete the owner's only
    // record of a live album — losing the token for good.
    console.error('[album/exists] lookup failed:', error.message)
    return NextResponse.json({ alive: slugs }, { headers: NO_STORE })
  }

  const found = new Set<string>()
  for (const row of data ?? []) {
    if (row.slug) found.add(row.slug)
    if (row.custom_slug) found.add(row.custom_slug)
  }
  return NextResponse.json({ alive: slugs.filter((s) => found.has(s)) }, { headers: NO_STORE })
}
