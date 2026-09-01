import { NextResponse } from 'next/server'
import { getUserTierById } from '@/lib/subscriptions'
import { createAdminClient } from '@/lib/supabase/admin'
import { albumEffectiveTier, type AlbumPackage } from '@/lib/album-entitlements'
import type { Tier } from '@/types'

// One place that answers "is this album allowed to use a paid feature".
//
// Before this, every gated route wrote the check by hand, and the two that existed had already
// drifted: both asked about the CALLER's plan rather than the album owner's, which meant one
// subscriber holding a shared owner link could mint paid features on albums belonging to strangers.
// Owner links are shareable by design, so that was not a corner case. Writing it once removes the
// opportunity to get it wrong the next nine times.
//
// TWO things can entitle an album now, and this is the only file that may combine them:
//
//   the OWNER's subscription — per account, covers everything they own
//   a PACKAGE bought for the album — one-off, covers that album for its paid years
//
// The check runs cheapest-first: the owner's tier is a 30s-cached lookup and satisfies almost
// every call today, so the package columns are only fetched for an album that would otherwise be
// REFUSED. That keeps the hot paths (face search, bib search at a live event) exactly as fast as
// before packages existed.
//
// ALWAYS the album's entitlement. Never the person making the request.

const NO_STORE = { 'Cache-Control': 'no-store' }

const RANK: Record<Tier, number> = { free: 0, pro: 1, studio: 2 }

/** The album being asked about. `id` is required so the package can be looked up; `user_id` is
 *  the owner column as fetched — null for an album with no account behind it. */
export type GateAlbum = { id: string; user_id: string | null }

async function packageFor(albumId: string): Promise<AlbumPackage | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('albums')
    .select('package_tier, package_expires_at')
    .eq('id', albumId)
    .maybeSingle<{ package_tier: 'pro' | 'studio' | null; package_expires_at: string | null }>()
  if (error || !data) {
    // A package we could not read is a package that does not grant (rule 19: the uncertain branch
    // does nothing). The owner's own tier was already considered, so nothing they subscribed to
    // is lost — only the one-off top-up goes unrecognised until the next request.
    if (error) console.error('[require-tier] package lookup failed:', error.message)
    return null
  }
  return { tier: data.package_tier, expiresAt: data.package_expires_at }
}

async function effectiveTier(album: GateAlbum): Promise<Tier> {
  const ownerTier = album.user_id ? await getUserTierById(album.user_id) : 'free'
  if (ownerTier === 'studio') return ownerTier   // nothing can outrank it; skip the package read
  const pkg = await packageFor(album.id)
  return albumEffectiveTier(ownerTier, pkg)
}

/**
 * Returns a Response to send back when the album's entitlement is too low, or null when it may
 * proceed.
 *
 * An album with no account and no live package cannot use paid features — but the check is on the
 * PACKAGE too, not the account alone: a packaged album that somehow lost its owner keeps working,
 * because somebody paid for it.
 */
export async function refuseBelowTier(
  album: GateAlbum,
  need: 'pro' | 'studio',
  feature: string,
): Promise<NextResponse | null> {
  const tier = await effectiveTier(album)
  if (RANK[tier] >= RANK[need]) return null

  if (!album.user_id) {
    return NextResponse.json(
      { error: `Sign in to use ${feature}` },
      { status: 401, headers: NO_STORE },
    )
  }
  // Names the plan needed rather than saying "upgrade", so the owner knows which one to buy without
  // going to find out.
  return NextResponse.json(
    { error: `${feature} requires a ${need === 'studio' ? 'Max' : 'Pro or Max'} plan` },
    { status: 403, headers: NO_STORE },
  )
}

/** True when this album is entitled to `need` or better. For reads, where a 403 is not wanted. */
export async function albumHasTier(album: GateAlbum, need: 'pro' | 'studio'): Promise<boolean> {
  return RANK[await effectiveTier(album)] >= RANK[need]
}
