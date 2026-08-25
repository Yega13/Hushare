import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAccountAdmin } from '@/lib/auth'
import { getActiveSubscription } from '@/lib/subscriptions'
import { createAdminClient } from '@/lib/supabase/admin'

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
  // Both in one round trip: the nav wants the picture, the polling screen wants the tier, and they
  // are asked on the same page loads.
  const admin = createAdminClient()
  const [subscription, profile] = await Promise.all([
    getActiveSubscription(user.id),
    admin.from('profiles').select('avatar_url').eq('user_id', user.id).maybeSingle<{ avatar_url: string | null }>(),
  ])
  const canAccessAccount = isAccountAdmin(user) || subscription !== null
  return NextResponse.json(
    {
      signedIn: true,
      canAccessAccount,
      tier: subscription?.tier ?? null,
      avatarUrl: profile.data?.avatar_url ?? null,
    },
    NO_CACHE,
  )
}
