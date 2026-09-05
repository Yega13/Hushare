import { NextResponse } from 'next/server'
import { refuseRateLimited, serverError } from '@/lib/server/respond'
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
    return refuseRateLimited(rl, 'Too many requests')
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
    // A PAYING customer cannot reach billing. Nobody learned.
    return serverError('portal', err, {
      status: 502, publicMessage: 'Could not open the billing portal. Please try again.',
    })
  }

  return NextResponse.redirect(portalUrl, { status: 303, headers: NO_STORE })
}
