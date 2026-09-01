import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCheckout } from '@/lib/polar'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import {
  PACKAGE_CATALOGUE, RENEWAL_CATALOGUE, isPackageKey, isRenewalKey,
} from '@/lib/package-catalogue'
import { track } from '@/lib/analytics'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// BUY A PACKAGE FOR ONE ALBUM.
//
// A package belongs to an ALBUM, not an account — so the proof required here is proof about the
// album: the owner cookie, the same one every album mutation demands. An account is NOT required.
// Deliberately: the buyer most likely to want a $49 one-off is an event organiser who made the
// album five minutes ago without signing up, and sending them through account creation to hand us
// money is how a sale dies. Polar collects their email at checkout for the receipt and the
// renewal reminders either way.
//
// The albumId rides in the checkout metadata and comes back on the order.paid webhook, which is
// where the entitlement is actually written. This route writes NOTHING — money changes state via
// exactly one path, the webhook, so a retried checkout, a closed tab, or an abandoned payment
// cannot leave a half-granted album.
export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  const rl = await checkRateLimit(clientIpKey(req, 'checkout'), 60, 10, { failOpen: true })
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: NO_STORE })
  }

  let body: { slug?: unknown; item?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: NO_STORE })
  }
  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  const item = body.item

  // Stable keys, never raw Polar ids — same reasoning as the plan checkout: the id lives in a
  // secret resolved at request time, so rotating a product at Polar never breaks a cached page.
  const spec = isPackageKey(item) ? PACKAGE_CATALOGUE[item]
    : isRenewalKey(item) ? RENEWAL_CATALOGUE[item]
    : null
  if (!slug || !spec) {
    return NextResponse.json({ error: 'Missing album or item' }, { status: 400, headers: NO_STORE })
  }

  const productId = process.env[spec.envVar]
  if (!productId) {
    console.error('[checkout/package] product env not set:', spec.envVar)
    return NextResponse.json({ error: 'This package is not available right now.' }, { status: 503, headers: NO_STORE })
  }

  // Owner proof — and the album's real id, which is what the webhook needs. A renewal bought by
  // whoever holds the owner link is fine by construction: it can only ever ADD time to the album.
  const access = await verifyOwnerViaCookieWithRateLimit(req, slug)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  // If they happen to be signed in, prefill the email so the receipt lands somewhere they read.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
  let checkout
  try {
    checkout = await createCheckout({
      productId,
      successUrl: `${site}/${slug}?package=thanks`,
      customerEmail: user?.email,
      metadata: { albumId: access.album.id, item: String(item) },
    })
  } catch (e) {
    console.error('[checkout/package] createCheckout failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502, headers: NO_STORE })
  }

  track({ name: 'checkout_started', userId: user?.id ?? null, tier: spec === RENEWAL_CATALOGUE.renewal_max || spec === PACKAGE_CATALOGUE.package_max ? 'studio' : 'pro', cycle: 'package' })
  return NextResponse.json({ url: checkout.url }, { headers: NO_STORE })
}
