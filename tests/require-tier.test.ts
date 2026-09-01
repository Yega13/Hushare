import { describe, it, expect, vi, beforeEach } from 'vitest'

// The knobs each test turns.
const cfg: {
  ownerTier: 'free' | 'pro' | 'studio'
  pkg: { package_tier: 'pro' | 'studio' | null; package_expires_at: string | null } | null
  pkgError: boolean
  pkgLookups: number
  tierLookups: number
} = { ownerTier: 'free', pkg: null, pkgError: false, pkgLookups: 0, tierLookups: 0 }

vi.mock('@/lib/subscriptions', () => ({
  getUserTierById: async () => { cfg.tierLookups++; return cfg.ownerTier },
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            cfg.pkgLookups++
            if (cfg.pkgError) return { data: null, error: { message: 'boom' } }
            return { data: cfg.pkg, error: null }
          },
        }),
      }),
    }),
  }),
}))

import { refuseBelowTier, albumHasTier } from '@/lib/require-tier'

const ALBUM = { id: 'alb-1', user_id: 'owner-1' }
const ANON = { id: 'alb-2', user_id: null }
const LIVE = '2099-01-01T00:00:00Z'
const DEAD = '2020-01-01T00:00:00Z'

beforeEach(() => {
  cfg.ownerTier = 'free'
  cfg.pkg = null
  cfg.pkgError = false
  cfg.pkgLookups = 0
  cfg.tierLookups = 0
})

describe('refuseBelowTier — packages entitle the album', () => {
  it('a FREE owner with a live Max Package passes a studio gate', async () => {
    // The whole point of Phase 3b: somebody who paid $99 must get Max on that album even though
    // their account has no subscription. Before this, every gate asked only the owner's plan.
    cfg.pkg = { package_tier: 'studio', package_expires_at: LIVE }
    expect(await refuseBelowTier(ALBUM, 'studio', 'Face Finder')).toBeNull()
  })

  it('a live Pro Package passes pro and still fails studio', async () => {
    cfg.pkg = { package_tier: 'pro', package_expires_at: LIVE }
    expect(await refuseBelowTier(ALBUM, 'pro', 'Photo moderation')).toBeNull()
    const refusal = await refuseBelowTier(ALBUM, 'studio', 'Bib number search')
    expect(refusal?.status).toBe(403)
  })

  it('an EXPIRED package grants nothing', async () => {
    cfg.pkg = { package_tier: 'studio', package_expires_at: DEAD }
    expect((await refuseBelowTier(ALBUM, 'pro', 'A custom album logo'))?.status).toBe(403)
  })

  it('a package we could not READ grants nothing', async () => {
    // rule 19: the uncertain branch does nothing. The owner's own tier was already considered, so
    // a subscriber loses nothing — only the one-off top-up goes unrecognised until the next call.
    cfg.pkgError = true
    expect((await refuseBelowTier(ALBUM, 'pro', 'The countdown reveal'))?.status).toBe(403)
  })

  it('an ANONYMOUS album with a live package is allowed — somebody paid for it', async () => {
    // Payment claims the album, so this state should not persist — but if a claim ever fails, the
    // album a customer paid $99 for must not refuse the features they bought.
    cfg.pkg = { package_tier: 'studio', package_expires_at: LIVE }
    expect(await refuseBelowTier(ANON, 'studio', 'Sponsor logos')).toBeNull()
  })

  it('an anonymous album with NO package still gets the sign-in 401', async () => {
    const refusal = await refuseBelowTier(ANON, 'pro', 'A custom album logo')
    expect(refusal?.status).toBe(401)
  })

  it('a subscribed owner passes exactly as before packages existed', async () => {
    cfg.ownerTier = 'pro'
    expect(await refuseBelowTier(ALBUM, 'pro', 'Photo moderation')).toBeNull()
    cfg.ownerTier = 'studio'
    expect(await refuseBelowTier(ALBUM, 'studio', 'Face Finder')).toBeNull()
  })
})

describe('the hot path stays as fast as before packages existed', () => {
  it('a Max owner never triggers the package lookup', async () => {
    // Face and bib search run per guest search at live events. The package read must only happen
    // for albums that would otherwise be REFUSED — a studio owner short-circuits past it.
    cfg.ownerTier = 'studio'
    await refuseBelowTier(ALBUM, 'studio', 'Face Finder')
    expect(cfg.pkgLookups).toBe(0)
  })

  it('an album that needs the package pays exactly one extra read', async () => {
    cfg.pkg = { package_tier: 'studio', package_expires_at: LIVE }
    await refuseBelowTier(ALBUM, 'studio', 'Face Finder')
    expect(cfg.pkgLookups).toBe(1)
  })
})

describe('albumHasTier — the read-side twin agrees', () => {
  it('sees a live package', async () => {
    cfg.pkg = { package_tier: 'studio', package_expires_at: LIVE }
    expect(await albumHasTier(ALBUM, 'studio')).toBe(true)
  })

  it('does not see an expired one', async () => {
    cfg.pkg = { package_tier: 'studio', package_expires_at: DEAD }
    expect(await albumHasTier(ALBUM, 'studio')).toBe(false)
  })
})
