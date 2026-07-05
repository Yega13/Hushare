import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { validateCustomSlug } from '@/lib/custom-slug'
import { getUserTierById } from '@/lib/subscriptions'
import { broadcastAlbumSettings } from '@/lib/broadcast'

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

  // Guest album owners have no account to upgrade — sign-in required
  if (!access.userId) {
    return NextResponse.json({ error: 'Sign in to use custom URLs' }, { status: 401, headers: NO_STORE })
  }

  // Custom URL requires Pro+
  const tier = await getUserTierById(access.userId)
  if (tier === 'free') {
    return NextResponse.json({ error: 'Custom URLs require a Pro or Studio plan' }, { status: 403, headers: NO_STORE })
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

  await broadcastAlbumSettings(access.album.id, { custom_slug: newCustomSlug })
  return NextResponse.json({ ok: true, custom_slug: newCustomSlug }, { headers: NO_STORE })
}
