import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveSubscription } from '@/lib/subscriptions'
import { createCustomerSession } from '@/lib/polar'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  const rl = await checkRateLimit(clientIpKey(req, 'portal'), 60, 5, { failOpen: true })
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: NO_STORE })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/login?next=/account', req.url), {
      status: 303,
      headers: NO_STORE,
    })
  }

  const subscription = await getActiveSubscription(user.id)
  if (!subscription) {
    return NextResponse.json(
      { error: 'No active subscription' },
      { status: 404, headers: NO_STORE },
    )
  }

  let portalUrl: string
  try {
    portalUrl = await createCustomerSession(subscription.polar_customer_id)
  } catch (err) {
    console.error('[portal] Polar customer session failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json(
      { error: 'Could not open the billing portal. Please try again.' },
      { status: 502, headers: NO_STORE },
    )
  }

  return NextResponse.redirect(portalUrl, { status: 303, headers: NO_STORE })
}
