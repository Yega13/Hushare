import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { refuseBelowTier } from '@/lib/require-tier'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { validateCustomSlug } from '@/lib/custom-slug'
import { queueAlbumSettingsBroadcast } from '@/lib/broadcast'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; custom_slug?: unknown } | null
  const { slug, custom_slug } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  // null / undefined = clear the custom URL
  if (custom_slug !== null && custom_slug !== undefined && typeof custom_slug !== 'string') {
    return NextResponse.json({ error: 'Invalid custom_slug' }, { status: 400, headers: NO_STORE })
  }

  let newCustomSlug: string | null = null
  if (typeof custom_slug === 'string' && custom_slug.trim().length > 0) {
    const validation = validateCustomSlug(custom_slug)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.reason }, { status: 400, headers: NO_STORE })
    }
    newCustomSlug = validation.slug
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  // The tier checked is the ALBUM OWNER'S, not the caller's.
  //
  // It used to be access.userId — whoever is holding the owner link right now. Owner links are
  // shareable by design, so that asked "is the person clicking this a subscriber?" rather than "is
  // this album on a paid plan?". One Pro account could collect owner links from free users and mint
  // this feature on albums it does not own, without limit — and, until the read-time check added
  // alongside this, permanently. Every other gate in the codebase already asks about
  // album.user_id: upload authorization, Stream, face search and Collections all do.
  // Guest album owners have no account to upgrade — sign-in required
  const ownerId = access.album.user_id
  if (!ownerId) {
    return NextResponse.json({ error: 'Sign in to use custom URLs' }, { status: 401, headers: NO_STORE })
  }

  // Custom URL requires Pro+ — but only to SET one.

  // ONLY TURNING IT ON IS GATED. Clearing it must always work, whatever the plan.
  //
  // The gate used to run before the update regardless of direction, so an owner on the free plan who
  // had set this while it was ungated could no longer take it off — the setting was frozen onto their
  // album for good. api/album/branding and api/album/media-settings already got this right and say
  // why: a lapsed or absent subscription should cost someone a feature, never the ability to undo it.
  // Releasing a custom URL also frees the name for someone else, so refusing it holds a public
  // address hostage to a plan the owner may no longer be on.
  if (newCustomSlug !== null) {
    // Package-aware: a Pro/Max Package entitles THIS album whatever the account's plan is.
    const refused = await refuseBelowTier(access.album, 'pro', 'A custom URL')
    if (refused) return refused
  }

  const admin = createAdminClient()

  if (newCustomSlug !== null) {
    // A random slug (8 alphanumeric) can shadow a custom_slug — block the conflict explicitly
    const { data: slugConflict } = await admin
      .from('albums')
      .select('id')
      .eq('slug', newCustomSlug)
      .maybeSingle()
    if (slugConflict) {
      return NextResponse.json({ error: 'This URL is already taken' }, { status: 409, headers: NO_STORE })
    }
  }

  const { error } = await admin
    .from('albums')
    .update({ custom_slug: newCustomSlug })
    .eq('id', access.album.id)

  if (error) {
    // 23505 = unique constraint violation — another album already has this custom_slug
    if (error.code === '23505') {
      return NextResponse.json({ error: 'This URL is already taken' }, { status: 409, headers: NO_STORE })
    }
    console.error('[album/custom-url] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update custom URL' }, { status: 500, headers: NO_STORE })
  }

  queueAlbumSettingsBroadcast(access.album.id, { custom_slug: newCustomSlug })
  return NextResponse.json({ ok: true, custom_slug: newCustomSlug }, { headers: NO_STORE })
}
