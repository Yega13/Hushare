import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { refuseBelowTier } from '@/lib/require-tier'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { queueAlbumSettingsBroadcast } from '@/lib/broadcast'
import { deleteR2ObjectByPublicUrl, isOwnAlbumAsset } from '@/lib/cloudflare/r2'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

type LogoAlbum = {
  id: string
  owner_token: string
  user_id: string | null
  custom_slug?: string | null
  logo_url: string | null
}

// Records a custom album logo after it's been uploaded to R2 (see logo/upload). A logo is a paid
// feature (documented on the Album type since the original Album Design migration) — gated here,
// server-side, same shape as the custom-accent-colour gate in /api/album/design.
function isValidLogoUrl(url: string | null, r2Host: string): boolean {
  if (url === null) return true
  try {
    const parsed = new URL(url)
    if (parsed.origin !== `https://${r2Host}`) return false
    if (!parsed.pathname.startsWith('/logos/')) return false
    if (parsed.pathname.includes('..')) return false
    return true
  } catch { return false }
}

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; logo_url?: unknown } | null
  const { slug, logo_url } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (logo_url !== null && typeof logo_url !== 'string') {
    return NextResponse.json({ error: 'Invalid logo_url' }, { status: 400, headers: NO_STORE })
  }
  if (typeof logo_url === 'string' && logo_url.length > 1024) {
    return NextResponse.json({ error: 'Invalid logo_url value' }, { status: 400, headers: NO_STORE })
  }
  const value = typeof logo_url === 'string' ? logo_url.trim() : null

  const r2Host = (process.env.R2_PUBLIC_HOST ?? '').trim().replace(/\/+$/, '')
  if (value !== null && !r2Host) {
    console.error('[album/logo] R2_PUBLIC_HOST not set')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500, headers: NO_STORE })
  }

  if (!isValidLogoUrl(value, r2Host)) {
    return NextResponse.json({ error: 'Invalid logo_url value' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit<LogoAlbum>(req, slug.trim(), 'logo_url')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  // A custom album logo is a paid feature — checked against the ALBUM OWNER'S plan, never the
  // caller's. Owner links are shareable, so asking about whoever is holding one would let a
  // single subscriber mint this on albums belonging to strangers.
  // ONLY TURNING IT ON IS GATED. Clearing it must always work, whatever the plan.
  //
  // The gate used to run before the update regardless of direction, so an owner on the free plan who
  // had set this while it was ungated could no longer take it off — the setting was frozen onto their
  // album for good. api/album/branding and api/album/media-settings already got this right and say
  // why: a lapsed or absent subscription should cost someone a feature, never the ability to undo it.
  if (value !== null) {
    const refusal = await refuseBelowTier(access.album, 'pro', 'A custom album logo')
    if (refusal) return refusal
  }

  // Ownership is known only now, so the album-scoped check has to happen here. The prefix check
  // above rejects wrong-host and wrong-folder URLs cheaply; this one rejects another album's asset.
  if (value !== null && !isOwnAlbumAsset(value, 'logos', access.album.id, r2Host)) {
    return NextResponse.json({ error: 'Invalid logo_url value' }, { status: 403, headers: NO_STORE })
  }

  // NOTE: the logo was gated to paid tiers. Gating is deliberately OFF while we get every design
  // feature working end-to-end; revisit pricing once the feature set settles. Keeping this comment
  // (and hasPaidAccess in lib) so re-adding the gate is a two-line change, not an archaeology dig.
  const admin = createAdminClient()
  const { error } = await admin.from('albums').update({ logo_url: value }).eq('id', access.album.id)
  if (error) {
    console.error('[album/logo] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update logo' }, { status: 500, headers: NO_STORE })
  }

  const oldValue = access.album.logo_url
  if (oldValue && oldValue !== value) {
    deleteR2ObjectByPublicUrl(oldValue)
  }

  queueAlbumSettingsBroadcast(access.album.id, { logo_url: value })
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
