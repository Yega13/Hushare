import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserTierById } from '@/lib/subscriptions'
import { STUDIO_MONTHLY_CREDITS } from '@/lib/studio/config'

// Server-side credit helpers. All go through SECURITY DEFINER SQL functions (see the
// 20260728_studio_credits migration) so balance changes are atomic and race-free — a spend can
// never double-apply even under concurrent generations.

function currentMonthUTC(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// Current balance, applying this month's free grant first (idempotent — only lands once per month).
export async function getStudioCredits(userId: string): Promise<number> {
  const admin = createAdminClient()
  const tier = await getUserTierById(userId)
  const monthly = STUDIO_MONTHLY_CREDITS[tier] ?? 0

  const { data, error } = await admin.rpc('studio_grant_monthly', {
    p_user: userId,
    p_amount: monthly,
    p_month: currentMonthUTC(),
  })
  if (error) {
    console.error('[studio/credits] grant_monthly failed:', error.message)
    const { data: row } = await admin
      .from('studio_credits').select('balance').eq('user_id', userId).maybeSingle<{ balance: number }>()
    return row?.balance ?? 0
  }
  return typeof data === 'number' ? data : 0
}

export type SpendResult =
  | { ok: true; balance: number }
  | { ok: false; reason: 'insufficient' | 'error' }

// Spend credits for a generation. Distinguishes "can't afford it" (fail closed, tell the user to
// buy more) from a transient DB error (retryable) — the caller must NOT run the generation on either
// failure, but they mean different things to the user.
export async function spendStudioCredits(
  userId: string,
  amount: number,
  meta?: Record<string, unknown>,
): Promise<SpendResult> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('studio_spend_credits', {
    p_user: userId, p_amount: amount, p_reason: 'generation', p_meta: meta ?? null,
  })
  if (error) {
    console.error('[studio/credits] spend failed:', error.message)
    return { ok: false, reason: 'error' }
  }
  const balance = typeof data === 'number' ? data : -1
  return balance < 0 ? { ok: false, reason: 'insufficient' } : { ok: true, balance } // -1 = insufficient
}

// Add credits (purchase / refund / admin adjust). Returns the new balance.
export async function addStudioCredits(
  userId: string,
  amount: number,
  reason: 'purchase' | 'refund' | 'admin_adjust',
  meta?: Record<string, unknown>,
): Promise<number> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('studio_add_credits', {
    p_user: userId, p_amount: amount, p_reason: reason, p_meta: meta ?? null,
  })
  if (error) {
    console.error('[studio/credits] add failed:', error.message)
    return 0
  }
  return typeof data === 'number' ? data : 0
}
