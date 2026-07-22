import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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

  const successUrl = new URL('/account?welcome=1', req.url).toString()

  const discountId =
    plan === 'pro_monthly'
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
    return NextResponse.json(
      { error: 'Could not start checkout. Please try again.' },
      { status: 502, headers: NO_STORE },
    )
  }

  track({ name: 'checkout_started', userId: user.id, tier, cycle })

  return NextResponse.redirect(checkout.url, { status: 303, headers: NO_STORE })
}
