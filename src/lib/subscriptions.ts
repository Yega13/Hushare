import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'
import type { Tier, Subscription } from '@/types'

// Renewal webhooks normally land within seconds, but a delayed or dropped one must never cut off
// someone who is genuinely paying. A week of slack makes a false negative (locking out a paying
// customer) essentially impossible, while still closing the hole below.
const ACTIVE_PERIOD_GRACE_MS = 7 * 24 * 60 * 60 * 1000

function isSubActive(sub: { status: string; current_period_end: string | null }): boolean {
  if (sub.status === 'active') {
    // 'active' used to be trusted unconditionally, which meant a single missed
    // subscription.canceled webhook granted that account paid features forever: the row simply
    // stayed 'active' with a period end far in the past and nothing ever re-checked it. Webhook
    // delivery is not guaranteed, so status alone cannot be the whole answer.
    // A null period end is treated as valid — that's how comped/manual grants are recorded.
    if (!sub.current_period_end) return true
    return new Date(sub.current_period_end).getTime() + ACTIVE_PERIOD_GRACE_MS > Date.now()
  }
  // Trialing and canceled both require a future period_end — a trialing sub with no
  // payment method may never receive a canceled event and would stay 'trialing' forever.
  // past_due means a payment failed but Polar hasn't canceled yet — grant access through
  // the current period so we don't cut users off mid-cycle during a payment retry window.
  if (sub.status === 'trialing' || sub.status === 'canceled' || sub.status === 'past_due') {
    return !!sub.current_period_end && new Date(sub.current_period_end) > new Date()
  }
  return false
}

export async function getActiveSubscription(userId: string): Promise<Subscription | null> {
  // Must use admin client — subscriptions table has RLS deny-all for anon/user clients
  const admin = createAdminClient()
  // A user can have MORE THAN ONE row (a resubscribe, or a bulk Polar sync). Never trust just the
  // newest — pick an ACTIVE one, preferring the higher tier, so a stale/canceled newest row can't
  // hide a genuinely active subscription and drop a paying user to free.
  const { data, error } = await admin
    .from('subscriptions')
    .select('id, user_id, polar_subscription_id, polar_customer_id, polar_product_id, tier, status, current_period_end, cancel_at_period_end, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)
    .returns<Subscription[]>()

  if (error) {
    console.error('[subscriptions] query failed:', error.message)
    return null
  }
  const active = (data ?? []).filter(isSubActive)
  if (active.length === 0) return null
  return active.find((s) => s.tier === 'studio') ?? active[0]
}

type UserLike = { id?: string | null; email?: string | null } | null | undefined

export async function getUserTier(user: UserLike): Promise<Tier> {
  if (!user?.id) return 'free'
  if (isAccountAdmin(user)) return 'studio'
  const sub = await getActiveSubscription(user.id)
  return sub?.tier ?? 'free'
}

type SubForTierCheck = {
  tier: 'pro' | 'studio'
  status: string
  current_period_end: string | null
  cancel_at_period_end: boolean
}

export async function getUserTierById(userId: string | null | undefined): Promise<Tier> {
  if (!userId) return 'free'

  const admin = createAdminClient()
  // Consider ALL of the user's rows (resubscribe / bulk sync can create several), and return the
  // highest ACTIVE tier — not merely the newest row, which might be a stale/canceled one.
  const { data: subs, error: subErr } = await admin
    .from('subscriptions')
    .select('tier, status, current_period_end, cancel_at_period_end')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)
    .returns<SubForTierCheck[]>()

  if (subErr) console.error('[subscriptions] getUserTierById query failed:', subErr.message)

  const active = (subs ?? []).filter(isSubActive)
  if (active.some((s) => s.tier === 'studio')) return 'studio'
  if (active.some((s) => s.tier === 'pro')) return 'pro'

  // Only make the auth round-trip when admin emails are configured — avoids unconditional
  // DB hit for every free-tier user when the admin override feature is not in use
  if (!process.env.ADMIN_EMAILS) return 'free'

  const { data: authData } = await admin.auth.admin.getUserById(userId)
  if (isAccountAdmin({ email: authData?.user?.email })) return 'studio'
  return 'free'
}

// RETENTION grace for lapsed paying customers. Policy: a paid album is kept while the
// subscription is active AND for 1 year after it ends. getUserTierById already returns the paid
// tier (→ kept) while active; this covers the FREE-again case: an owner whose subscription has
// lapsed still gets a 1-year grace from their last paid period end before the free retention
// window applies. Returns the timestamp until which the owner's albums must be preserved due to
// PAST paid status, or null if the owner never had a subscription (pure free).
const PAID_GRACE_MS = 365 * 24 * 60 * 60 * 1000
export async function getPaidRetentionUntil(userId: string | null | undefined): Promise<Date | null> {
  if (!userId) return null
  const admin = createAdminClient()
  const { data: sub, error } = await admin
    .from('subscriptions')
    .select('current_period_end')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ current_period_end: string | null }>()
  if (error) {
    // On uncertainty, protect the album (return a far-future date) — never delete on a failed check.
    console.error('[subscriptions] getPaidRetentionUntil query failed:', error.message)
    return new Date(Date.now() + PAID_GRACE_MS)
  }
  if (!sub) return null // no subscription history → pure free tier
  if (sub.current_period_end) return new Date(new Date(sub.current_period_end).getTime() + PAID_GRACE_MS)
  // Had a subscription row but no recorded period end — be conservative, grant grace from now.
  return new Date(Date.now() + PAID_GRACE_MS)
}

const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, studio: 2 }

export async function requireTier(
  user: UserLike,
  min: Tier,
): Promise<{ have: Tier } | null> {
  const have = await getUserTier(user)
  if (TIER_RANK[have] >= TIER_RANK[min]) return null
  return { have }
}

// Server-side paid-feature gate. Uses getUserTierById (NOT getActiveSubscription) so it applies
// the SAME rules the client's /api/me/tier sees — including the account-admin override, which
// grants studio with no subscription row. Gating on getActiveSubscription instead silently
// disagrees with the UI: the owner sees an unlocked control, uses it, and the server 403s, so the
// optimistic update rolls back and the change appears to "delete itself" a moment later.
export async function hasPaidAccess(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  return (await getUserTierById(userId)) !== 'free'
}
