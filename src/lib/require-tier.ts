import { NextResponse } from 'next/server'
import { getUserTierById } from '@/lib/subscriptions'
import type { Tier } from '@/types'

// One place that answers "is this album allowed to use a paid feature".
//
// Before this, every gated route wrote the check by hand, and the two that existed had already
// drifted: both asked about the CALLER's plan rather than the album owner's, which meant one
// subscriber holding a shared owner link could mint paid features on albums belonging to strangers.
// Owner links are shareable by design, so that was not a corner case. Writing it once removes the
// opportunity to get it wrong the next nine times.
//
// ALWAYS the album's owner. Never the person making the request.

const NO_STORE = { 'Cache-Control': 'no-store' }

const RANK: Record<Tier, number> = { free: 0, pro: 1, studio: 2 }

/**
 * Returns a Response to send back when the album's plan is too low, or null when it may proceed.
 *
 * `ownerId` is the album's `user_id`. A guest album has none, and cannot use paid features — there
 * is no account behind it to check a plan against, and nothing to upgrade.
 */
export async function refuseBelowTier(
  ownerId: string | null | undefined,
  need: 'pro' | 'studio',
  feature: string,
): Promise<NextResponse | null> {
  if (!ownerId) {
    return NextResponse.json(
      { error: `Sign in to use ${feature}` },
      { status: 401, headers: NO_STORE },
    )
  }
  const tier = await getUserTierById(ownerId)
  if (RANK[tier] >= RANK[need]) return null

  // Names the plan needed rather than saying "upgrade", so the owner knows which one to buy without
  // going to find out.
  return NextResponse.json(
    { error: `${feature} requires a ${need === 'studio' ? 'Max' : 'Pro or Max'} plan` },
    { status: 403, headers: NO_STORE },
  )
}

/** True when this album's owner is on `need` or better. For reads, where a 403 is not wanted. */
export async function albumHasTier(
  ownerId: string | null | undefined,
  need: 'pro' | 'studio',
): Promise<boolean> {
  if (!ownerId) return false
  return RANK[await getUserTierById(ownerId)] >= RANK[need]
}
