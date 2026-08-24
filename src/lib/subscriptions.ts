import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'
import type { Tier, Subscription } from '@/types'

// Renewal webhooks normally land within seconds, but a delayed or dropped one must never cut off
// someone who is genuinely paying. A week of slack makes a false negative (locking out a paying
// customer) essentially impossible, while still closing the hole below.
const ACTIVE_PERIOD_GRACE_MS = 7 * 24 * 60 * 60 * 1000

// Exported for tests. This function decides whether someone keeps paid features and whether their
// album is protected from retirement — the two places where being wrong costs a customer or their
// photos. It is worth asserting directly rather than only through the DB-bound callers.
export function isSubActive(sub: { status: string; current_period_end: string | null }): boolean {
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

// Short-lived per-isolate cache for the tier lookup.
//
// This call sits on two hot paths at once: /api/upload/presign runs it once per FILE, and the album
// page now runs it on every load to size that album's upload caps. At an event both explode against
// the SAME user id — hundreds of guests opening one album, then hundreds of photos each — and every
// one of those asks an identical question with an identical answer. Worse, for a registered free
// owner the miss path also makes an auth.admin round trip to resolve the ADMIN_EMAILS override.
//
// Keyed strictly by user id, so no request can ever be served another user's answer, and holding
// only a tier — not a session, not a token. 30s is long enough to collapse a crowd into one lookup
// and short enough that an upgrade lands while the buyer is still on the page.
const TIER_TTL_MS = 30_000
// Bounds memory on a long-lived isolate. Cleared wholesale rather than evicted one by one: this is
// a latency cache, and rebuilding it costs one query per active album.
const TIER_CACHE_MAX = 500
const tierCache = new Map<string, { tier: Tier; at: number }>()

export async function getUserTierById(userId: string | null | undefined): Promise<Tier> {
  if (!userId) return 'free'

  const cached = tierCache.get(userId)
  if (cached && Date.now() - cached.at < TIER_TTL_MS) return cached.tier

  const { tier, cacheable } = await computeUserTier(userId)
  // A failed subscriptions query degrades to 'free'. Never cache that — it would turn one blip into
  // 30 seconds of a paying customer being told their album is free tier.
  if (cacheable) {
    if (tierCache.size >= TIER_CACHE_MAX) tierCache.clear()
    tierCache.set(userId, { tier, at: Date.now() })
  }
  return tier
}

async function computeUserTier(userId: string): Promise<{ tier: Tier; cacheable: boolean }> {
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
  if (active.some((s) => s.tier === 'studio')) return { tier: 'studio', cacheable: true }
  if (active.some((s) => s.tier === 'pro')) return { tier: 'pro', cacheable: true }

  // Below here the answer is 'free' unless the admin override says otherwise. If the query that
  // got us here FAILED, 'free' is a guess rather than a fact, so it must not be remembered.
  const cacheable = !subErr

  // Only make the auth round-trip when admin emails are configured — avoids unconditional
  // DB hit for every free-tier user when the admin override feature is not in use
  if (!process.env.ADMIN_EMAILS) return { tier: 'free', cacheable }

  const { data: authData } = await admin.auth.admin.getUserById(userId)
  if (isAccountAdmin({ email: authData?.user?.email })) return { tier: 'studio', cacheable }
  return { tier: 'free', cacheable }
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
  // ALL rows, not the newest one.
  //
  // The two functions above deliberately scan every row, with a comment explaining that a user can
  // have several (a resubscribe, or a bulk Polar sync) and that the newest must never be trusted
  // alone. This one trusted it anyway. admin/sync-polar inserts rows with created_at set to the
  // sync time in whatever order Polar returned them, so the newest-CREATED row can easily carry an
  // OLDER current_period_end than a sibling. The retention window is then computed short and
  // retire-albums deletes a paying customer's albums up to a year early.
  //
  // This is the last check before permanent deletion, so it takes the furthest-future end date any
  // row claims.
  const { data: subs, error } = await admin
    .from('subscriptions')
    .select('current_period_end')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)
    .returns<{ current_period_end: string | null }[]>()
  if (error) {
    // On uncertainty, protect the album (return a far-future date) — never delete on a failed check.
    console.error('[subscriptions] getPaidRetentionUntil query failed:', error.message)
    return new Date(Date.now() + PAID_GRACE_MS)
  }
  if (!subs || subs.length === 0) return null // no subscription history → pure free tier

  const ends = subs
    .map(s => (s.current_period_end ? new Date(s.current_period_end).getTime() : NaN))
    .filter(t => Number.isFinite(t))
  if (ends.length > 0) return new Date(Math.max(...ends) + PAID_GRACE_MS)
  // Had subscription rows but none recorded a period end — be conservative, grant grace from now.
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
