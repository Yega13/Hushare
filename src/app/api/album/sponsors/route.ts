import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { queueAlbumSettingsBroadcast } from '@/lib/broadcast'
import { deleteR2ObjectByPublicUrl, isOwnAlbumAsset } from '@/lib/cloudflare/r2'
import type { SponsorLogo } from '@/types'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_SPONSORS = 12
const MAX_NAME_LEN = 60

type SponsorAlbum = {
  id: string
  owner_token: string
  user_id: string | null
  custom_slug?: string | null
  sponsor_logos: unknown
}

// Replace-whole-array semantics: the client sends the complete desired list (after any local
// add/remove/reorder), never a delta — simplest correct way to handle reordering without a
// separate move-index endpoint. Every entry's URL is re-validated server-side on every save, so a
// tampered client payload can't smuggle in an arbitrary image host.
function isValidSponsorUrl(url: string, r2Host: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.origin !== `https://${r2Host}`) return false
    if (!parsed.pathname.startsWith('/sponsors/')) return false
    if (parsed.pathname.includes('..')) return false
    return true
  } catch { return false }
}

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; sponsor_logos?: unknown } | null
  const { slug, sponsor_logos } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (!Array.isArray(sponsor_logos) || sponsor_logos.length > MAX_SPONSORS) {
    return NextResponse.json({ error: `sponsor_logos must be an array of up to ${MAX_SPONSORS}` }, { status: 400, headers: NO_STORE })
  }

  const r2Host = (process.env.R2_PUBLIC_HOST ?? '').trim().replace(/\/+$/, '')
  if (sponsor_logos.length > 0 && !r2Host) {
    console.error('[album/sponsors] R2_PUBLIC_HOST not set')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500, headers: NO_STORE })
  }

  const next: SponsorLogo[] = []
  for (const raw of sponsor_logos) {
    if (typeof raw !== 'object' || raw === null) {
      return NextResponse.json({ error: 'Each sponsor entry must be an object' }, { status: 400, headers: NO_STORE })
    }
    const r = raw as Record<string, unknown>
    if (typeof r.id !== 'string' || typeof r.url !== 'string' || !isValidSponsorUrl(r.url, r2Host)) {
      return NextResponse.json({ error: 'Each sponsor entry needs a valid id and url' }, { status: 400, headers: NO_STORE })
    }
    if (r.name !== null && r.name !== undefined && typeof r.name !== 'string') {
      return NextResponse.json({ error: 'Sponsor name must be a string or null' }, { status: 400, headers: NO_STORE })
    }
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, MAX_NAME_LEN) : null
    next.push({ id: r.id, url: r.url, name: name || null })
  }

  const access = await verifyOwnerViaCookieWithRateLimit<SponsorAlbum>(req, slug.trim(), 'sponsor_logos')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  // Ownership is known only now. Every entry is checked, not just the first: the route diffs the
  // old list against the new one and deletes whatever disappeared, so a single foreign URL smuggled
  // into the list and then removed would delete another album's sponsor logo.
  if (next.some((sp) => !isOwnAlbumAsset(sp.url, 'sponsors', access.album.id, r2Host))) {
    return NextResponse.json({ error: 'Each sponsor entry needs a valid id and url' }, { status: 403, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('albums').update({ sponsor_logos: next }).eq('id', access.album.id)
  if (error) {
    console.error('[album/sponsors] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update sponsors' }, { status: 500, headers: NO_STORE })
  }

  // Clean up R2 objects for any sponsor logo that was removed (present before, absent now).
  // Fire-and-forget, best-effort — same helper every other design-image route uses.
  const prevList = Array.isArray(access.album.sponsor_logos) ? access.album.sponsor_logos as SponsorLogo[] : []
  const nextUrls = new Set(next.map((s) => s.url))
  for (const prev of prevList) {
    if (prev?.url && !nextUrls.has(prev.url)) deleteR2ObjectByPublicUrl(prev.url)
  }

  queueAlbumSettingsBroadcast(access.album.id, { sponsor_logos: next })
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
