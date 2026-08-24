import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAccountAdmin } from '@/lib/auth'
import { getActiveSubscription } from '@/lib/subscriptions'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const NO_CACHE = { headers: { 'Cache-Control': 'no-store' } }

  if (!user) {
    return NextResponse.json({ signedIn: false, canAccessAccount: false }, NO_CACHE)
  }

  // `tier` is reported alongside access because "can they get in" is not enough for the
  // just-purchased poll: an upgrade already has access on the OLD subscription, so the only signal
  // that the new one has landed is the tier changing. Same single lookup either way — access is
  // derived from the subscription rather than fetched separately.
  const subscription = await getActiveSubscription(user.id)
  const canAccessAccount = isAccountAdmin(user) || subscription !== null
  return NextResponse.json(
    { signedIn: true, canAccessAccount, tier: subscription?.tier ?? null },
    NO_CACHE,
  )
}
