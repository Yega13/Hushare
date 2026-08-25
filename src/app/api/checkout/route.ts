import { NextResponse } from 'next/server'
import { reportServerError } from '@/lib/report-server-error'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createCheckout, productIdForPlan } from '@/lib/polar'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { track } from '@/lib/analytics'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  const rl = await checkRateLimit(clientIpKey(req, 'checkout'), 60, 10, { failOpen: true })
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: NO_STORE })
  }

  // The client sends a stable PLAN KEY (e.g. "pro_monthly"), never a raw Polar product ID — see
  // productIdForPlan() in lib/polar.ts for why. Resolved to the live product ID below, at request
  // time, so a Polar secret change takes effect immediately even for a 24h-cached pricing page.
  let plan: string | null = null
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const body = (await req.json()) as { plan?: string }
      plan = body.plan ?? null
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: NO_STORE })
    }
  } else {
    const form = await req.formData()
    const value = form.get('plan')
    plan = typeof value === 'string' ? value : null
  }

  if (!plan) {
    return NextResponse.json({ error: 'Missing plan' }, { status: 400, headers: NO_STORE })
  }

  const resolved = productIdForPlan(plan)
  if (!resolved) {
    return NextResponse.json({ error: 'This plan is not available right now.' }, { status: 400, headers: NO_STORE })
  }
  const { productId, tier, cycle } = resolved

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || !user.email) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('next', `/pricing?plan=${encodeURIComponent(plan)}`)
    return NextResponse.redirect(loginUrl, { status: 303, headers: NO_STORE })
  }

  // The success URL names the tier that was JUST BOUGHT, not merely "something was bought".
  //
  // Without it the account page can only ask "does this person have a subscription?", and for an
  // upgrade the answer is yes before the purchase has landed — a Pro customer buying Max would be
  // congratulated on being Pro, using the Pro feature list, because their old row is still the only
  // one there. Carrying the tier lets the page tell "already had one" apart from "just got this
  // one" and wait for the row it is actually looking for.
  // `max`, not `studio`. The tier column has said 'studio' since before the plan was named, and
  // that internal word has no business in a URL a customer sees. The page accepts both, so links
  // already sitting in a browser history from an earlier checkout still work.
  const successUrl = new URL(`/account?welcome=${tier === 'studio' ? 'max' : tier}`, req.url).toString()

  // "First month $1.99 — applies once per account" is a promise this code now keeps itself.
  //
  // The discount used to be attached to every monthly checkout unconditionally, which left the
  // once-per-account part entirely to how the discount object happens to be configured in Polar.
  // If that is set to unlimited redemptions — and nothing here could tell — then subscribe, cancel,
  // resubscribe is $1.99 forever, and the page saying otherwise is simply untrue.
  //
  // Anyone who has EVER had a subscription row has had their first month. Not "active": a customer
  // who cancelled has still already taken the intro price once, and this is the only reading that
  // matches what the pricing page says.
  //
  // Fails toward NOT discounting. A lookup that errors returns null, which withholds the offer
  // rather than granting it — the wrong side of this is giving a discount away forever, and someone
  // who was owed one will say so, whereas a repeated discount is silent.
  let hasSubscribedBefore = true
  try {
    const admin = createAdminClient()
    const { count, error } = await admin
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
    hasSubscribedBefore = error ? true : (count ?? 0) > 0
  } catch (err) {
    console.error('[checkout] intro-discount eligibility lookup failed:', err)
  }

  const discountId = hasSubscribedBefore
    ? undefined
    : plan === 'pro_monthly'
      ? process.env.POLAR_DISCOUNT_PRO_FIRST_MONTH
      : plan === 'studio_monthly'
        ? process.env.POLAR_DISCOUNT_STUDIO_FIRST_MONTH
        : undefined

  let checkout
  try {
    checkout = await createCheckout({
      productId,
      successUrl,
      customerEmail: user.email,
      metadata: { userId: user.id, tier, cycle },
      discountId,
    })
  } catch (err) {
    console.error(
      '[checkout] Polar createCheckout failed:', err instanceof Error ? err.message : String(err),
      '| plan:', plan,
      '| productId:', productId,
      '| discountId:', discountId ?? 'none',
    )
    reportServerError('checkout', 'Could not start checkout. Please try again. (502)')
    return NextResponse.json(
      { error: 'Could not start checkout. Please try again.' },
      { status: 502, headers: NO_STORE },
    )
  }

  track({ name: 'checkout_started', userId: user.id, tier, cycle })

  return NextResponse.redirect(checkout.url, { status: 303, headers: NO_STORE })
}
