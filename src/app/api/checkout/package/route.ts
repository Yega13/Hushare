import { NextResponse } from 'next/server'
import { refuseRateLimited, refuseAccess } from '@/lib/server/respond'
import { createClient } from '@/lib/supabase/server'
import { createCheckout } from '@/lib/polar'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { verifyOwnerViaCookieOrAccount } from '@/lib/album-owner-access'
import {
  PACKAGE_CATALOGUE, RENEWAL_CATALOGUE, isPackageKey, isRenewalKey,
} from '@/lib/package-catalogue'
import { track } from '@/lib/analytics'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// BUY A PACKAGE FOR ONE ALBUM.
//
// Two proofs, both required:
//
//   the OWNER COOKIE — proof about the album, the same one every album mutation demands
//   a SIGNED-IN ACCOUNT — the owner's explicit call, overriding an earlier no-account design:
//   "losing it is going to affect us detrimentally and finding it later is going to be hard
//   among 100s of albums." A $99 album reachable only through a link in somebody's browser is a
//   support case waiting to happen, and the renewal emails two years out need somewhere to land.
//
// Requiring the account has two consequences handled elsewhere, deliberately:
//   - payment CLAIMS the album: the webhook stamps the buyer's user_id if it is still unowned,
//     so a paid album can never sit anonymous (money is the strongest proof of intent we get);
//   - packaged albums do not count against the account's album cap (they are paid for
//     individually), so the free 3-album cap can never strand the album someone just bought.
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
    return refuseRateLimited(rl, 'Too many requests')
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

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) {
    // JSON with a code, not a redirect: the buy button is a fetch, and the UI turns this into its
    // own sign-in prompt without losing the album the person was standing on.
    return NextResponse.json(
      { error: 'Sign in to buy a package — it keeps the album on your account.', code: 'sign_in_required' },
      { status: 401, headers: NO_STORE },
    )
  }

  // Owner proof: the owner cookie, OR being signed in as the account that owns the album. The
  // second is what makes the renewal email work — it lands two years later on a device where the
  // cookie never existed, and a packaged album is guaranteed claimed, so the account IS the proof.
  // A renewal bought by whoever holds the owner link is fine by construction either way: it can
  // only ever ADD time to the album.
  const access = await verifyOwnerViaCookieOrAccount(req, slug, user.id)
  if (!access.ok) {
    return refuseAccess(access)
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
  let checkout
  try {
    checkout = await createCheckout({
      productId,
      successUrl: `${site}/${slug}?package=thanks`,
      customerEmail: user.email,
      metadata: { albumId: access.album.id, item: String(item), userId: user.id },
    })
  } catch (e) {
    console.error('[checkout/package] createCheckout failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502, headers: NO_STORE })
  }

  track({ name: 'checkout_started', userId: user.id, tier: spec === RENEWAL_CATALOGUE.renewal_max || spec === PACKAGE_CATALOGUE.package_max ? 'studio' : 'pro', cycle: 'package' })
  return NextResponse.json({ url: checkout.url }, { headers: NO_STORE })
}
