import { describe, it, expect } from 'vitest'
import {
  albumCap, registeringWouldHelp, upgradingWouldHelp, capNudge, MAX_MEDIA_CAP_OVERRIDE,
  LEGACY_ALL_BEFORE,
} from '../src/lib/album-entitlements'
import { GRANDFATHER_FREE_BEFORE } from '../src/lib/media'
import {
  ANON_ALBUM_MEDIA, FREE_ALBUM_MEDIA, PRO_ALBUM_MEDIA, STUDIO_ALBUM_MEDIA, LEGACY_FREE_ALBUM_MEDIA,
} from '../src/lib/media'

// Real dates either side of both cutoffs (2026-08-02 and 2026-08-25).
const OLD = '2026-07-20T10:00:00Z'   // before both
const MID = '2026-08-10T10:00:00Z'   // after the first, before the second
const NEW = '2026-08-26T10:00:00Z'   // after both

const cap = (ownerTier: Parameters<typeof albumCap>[0]['ownerTier'], createdAt: string, override: number | null = null) =>
  albumCap({ ownerTier, createdAt, override }).cap

describe('albumCap — behaviour that already existed must not change', () => {
  it('an anonymous album gets the guest allowance', () => {
    expect(cap(null, NEW)).toBe(ANON_ALBUM_MEDIA)
    expect(cap(null, MID)).toBe(ANON_ALBUM_MEDIA)
  })

  it('a registered free album gets the free allowance', () => {
    expect(cap('free', NEW)).toBe(FREE_ALBUM_MEDIA)
  })

  it('a free album from before the allowance was lowered keeps the old one', () => {
    expect(cap('free', MID)).toBe(LEGACY_FREE_ALBUM_MEDIA)
  })

  it('ANY album from before the per-tier caps landed keeps the 1,000 ceiling', () => {
    // Including anonymous ones — that promise was not scoped to accounts.
    expect(cap(null, OLD)).toBe(LEGACY_FREE_ALBUM_MEDIA)
    expect(cap('free', OLD)).toBe(LEGACY_FREE_ALBUM_MEDIA)
  })

  it('a hand-set override outranks everything, and is clamped', () => {
    expect(cap('free', NEW, 30_000)).toBe(30_000)
    expect(cap(null, OLD, 30_000)).toBe(30_000)
    expect(cap('free', NEW, 999_999)).toBe(MAX_MEDIA_CAP_OVERRIDE)
    // Zero and negatives are not an override, they are a missing value.
    expect(cap('free', NEW, 0)).toBe(FREE_ALBUM_MEDIA)
    expect(cap('free', NEW, -5)).toBe(FREE_ALBUM_MEDIA)
  })
})

describe('albumCap — the shadowing bug', () => {
  it('A PAID PLAN IS NEVER LOWERED TO A GRANDFATHERED CEILING', () => {
    // THE BUG. photos/create tested `created_at < 2026-08-02` FIRST and returned a hard 1,000,
    // so a Max owner's older album was capped at a tenth of what they paid for, and the tier
    // branch below it was unreachable for those albums.
    expect(cap('pro', OLD)).toBe(PRO_ALBUM_MEDIA)
    expect(cap('studio', OLD)).toBe(STUDIO_ALBUM_MEDIA)
    expect(cap('pro', MID)).toBe(PRO_ALBUM_MEDIA)
    expect(cap('studio', MID)).toBe(STUDIO_ALBUM_MEDIA)
  })

  it('grandfathering still ADDS where the plan gives less', () => {
    // The other direction must survive: an old free album keeps 1,000 even though free is now 500.
    expect(cap('free', OLD)).toBeGreaterThan(FREE_ALBUM_MEDIA)
    expect(cap(null, OLD)).toBeGreaterThan(ANON_ALBUM_MEDIA)
  })

  it('is never below what the plan alone would give, for any combination', () => {
    // The invariant behind both halves, stated once.
    for (const tier of [null, 'free', 'pro', 'studio'] as const) {
      for (const d of [OLD, MID, NEW]) {
        const planOnly = albumCap({ ownerTier: tier, createdAt: NEW, override: null }).cap
        expect(cap(tier, d), `${tier} @ ${d}`).toBeGreaterThanOrEqual(planOnly)
      }
    }
  })
})

describe('albumCap — an unreadable date must not shrink an album', () => {
  it('grandfathers rather than guessing', () => {
    // created_at is NOT NULL so this should be unreachable. If it ever is reached, giving an album
    // room it should not have costs a little storage; taking room from something someone already
    // built is not recoverable.
    expect(albumCap({ ownerTier: 'free', createdAt: null, override: null }).cap).toBe(LEGACY_FREE_ALBUM_MEDIA)
    expect(albumCap({ ownerTier: 'free', createdAt: 'not-a-date', override: null }).cap).toBe(LEGACY_FREE_ALBUM_MEDIA)
    expect(albumCap({ ownerTier: 'studio', createdAt: null, override: null }).cap).toBe(STUDIO_ALBUM_MEDIA)
  })
})

describe('registeringWouldHelp — never promise space that will not arrive', () => {
  it('is true for an ordinary guest album, where registering really does give more', () => {
    expect(registeringWouldHelp({ ownerTier: null, createdAt: NEW, override: null })).toBe(true)
  })

  it('IS FALSE for a grandfathered guest album, which is what the old message got wrong', () => {
    // A guest album created before 2026-08-02 already holds 1,000. Registering makes it a free
    // album, which is also grandfathered to 1,000 — identical. The old code told these owners
    // "Register on Hushare to get more space" at the exact moment it stopped accepting photos.
    const old = { ownerTier: null, createdAt: OLD, override: null }
    expect(albumCap(old).cap).toBe(LEGACY_FREE_ALBUM_MEDIA)
    expect(albumCap({ ...old, ownerTier: 'free' as const }).cap).toBe(LEGACY_FREE_ALBUM_MEDIA)
    expect(registeringWouldHelp(old)).toBe(false)
  })

  it('is false when there is already an account, whatever the plan', () => {
    for (const tier of ['free', 'pro', 'studio'] as const) {
      expect(registeringWouldHelp({ ownerTier: tier, createdAt: NEW, override: null })).toBe(false)
    }
  })

  it('is false for a hand-set ceiling, which has nothing to do with plans', () => {
    expect(registeringWouldHelp({ ownerTier: null, createdAt: NEW, override: 30_000 })).toBe(false)
  })
})

describe('upgradingWouldHelp — the same honesty for the paid nudge', () => {
  it('is true below the top plan and false at it', () => {
    expect(upgradingWouldHelp({ ownerTier: 'free', createdAt: NEW, override: null })).toBe(true)
    expect(upgradingWouldHelp({ ownerTier: 'pro', createdAt: NEW, override: null })).toBe(true)
    expect(upgradingWouldHelp({ ownerTier: 'studio', createdAt: NEW, override: null })).toBe(false)
  })

  it('is false when a hand-set ceiling already decides the cap', () => {
    // A partner album at 30,000 gains nothing from Max's 10,000, so the upsell would be a lie.
    expect(upgradingWouldHelp({ ownerTier: 'free', createdAt: NEW, override: 30_000 })).toBe(false)
  })
})

describe('the floor photos/create relies on', () => {
  it('NO album without an override can be capped below ANON_ALBUM_MEDIA', () => {
    // photos/create skips the tier lookup entirely when an album holds fewer than
    // ANON_ALBUM_MEDIA items, on the grounds that nothing without an override can be full below
    // that. If any tier or grandfather path ever returned less, that shortcut would silently stop
    // enforcing the cap for the albums it applies to — a cost bug nobody would see.
    for (const tier of [null, 'free', 'pro', 'studio'] as const) {
      for (const d of [OLD, MID, NEW, null]) {
        const { cap: c } = albumCap({ ownerTier: tier, createdAt: d, override: null })
        expect(c, `${tier} @ ${d}`).toBeGreaterThanOrEqual(ANON_ALBUM_MEDIA)
      }
    }
  })

  it('an override CAN be below it, which is why it is excluded from the shortcut', () => {
    expect(albumCap({ ownerTier: 'free', createdAt: NEW, override: 100 }).cap).toBe(100)
  })
})

describe('the cutoff dates themselves', () => {
  it('are exactly the two dates that were promised, to the millisecond', () => {
    // Nothing else pins these. Shifting either by a week is invisible to every other test here —
    // OLD/MID/NEW sit far from both boundaries — while silently changing what a week of real
    // albums was promised. These are the promises, written down.
    expect(new Date(LEGACY_ALL_BEFORE).toISOString()).toBe('2026-08-02T00:00:00.000Z')
    expect(new Date(GRANDFATHER_FREE_BEFORE).toISOString()).toBe('2026-08-25T00:00:00.000Z')
  })

  it('are exclusive: an album created ON the cutoff gets the new rules, not the old', () => {
    // "created before X" has to mean before. An off-by-one here moves a whole day of albums.
    expect(albumCap({ ownerTier: null, createdAt: '2026-08-02T00:00:00.000Z', override: null }).cap)
      .toBe(ANON_ALBUM_MEDIA)
    expect(albumCap({ ownerTier: null, createdAt: '2026-08-01T23:59:59.999Z', override: null }).cap)
      .toBe(LEGACY_FREE_ALBUM_MEDIA)
    expect(albumCap({ ownerTier: 'free', createdAt: '2026-08-25T00:00:00.000Z', override: null }).cap)
      .toBe(FREE_ALBUM_MEDIA)
    expect(albumCap({ ownerTier: 'free', createdAt: '2026-08-24T23:59:59.999Z', override: null }).cap)
      .toBe(LEGACY_FREE_ALBUM_MEDIA)
  })
})

describe('reason — the field the route phrases its message from', () => {
  it('names the actual source of the cap, not just a number', () => {
    expect(albumCap({ ownerTier: null, createdAt: NEW, override: null }).reason).toBe('anon')
    expect(albumCap({ ownerTier: 'free', createdAt: NEW, override: null }).reason).toBe('plan')
    expect(albumCap({ ownerTier: 'studio', createdAt: NEW, override: null }).reason).toBe('plan')
    expect(albumCap({ ownerTier: 'free', createdAt: OLD, override: null }).reason).toBe('legacy')
    expect(albumCap({ ownerTier: null, createdAt: OLD, override: null }).reason).toBe('legacy')
    expect(albumCap({ ownerTier: 'free', createdAt: NEW, override: 30_000 }).reason).toBe('override')
  })

  it('says legacy only when grandfathering actually raised the cap', () => {
    // A paid plan above the legacy ceiling is decided by the plan, not by grandfathering.
    expect(albumCap({ ownerTier: 'pro', createdAt: OLD, override: null }).reason).toBe('plan')
    expect(albumCap({ ownerTier: 'studio', createdAt: OLD, override: null }).reason).toBe('plan')
  })
})

describe('capNudge — what a full album may tell someone to do', () => {
  it('NEVER tells a guest to upgrade a plan they do not have', () => {
    // THE BUG. A guest album created before 2026-08-02 holds 1,000; registering also gives 1,000,
    // so the register nudge correctly declines — and the first version fell straight through to
    // "Upgrade your plan for more space", said to somebody with no account and no billing
    // relationship at all. An instruction they cannot follow is worse than saying nothing.
    expect(capNudge({ ownerTier: null, createdAt: OLD, override: null })).toBe('none')
    expect(upgradingWouldHelp({ ownerTier: null, createdAt: OLD, override: null })).toBe(false)
    expect(upgradingWouldHelp({ ownerTier: null, createdAt: NEW, override: null })).toBe(false)
  })

  it('offers registration to an ordinary guest album, where it genuinely helps', () => {
    expect(capNudge({ ownerTier: null, createdAt: NEW, override: null })).toBe('register')
  })

  it('offers an upgrade only to somebody who has an account and room to grow', () => {
    expect(capNudge({ ownerTier: 'free', createdAt: NEW, override: null })).toBe('upgrade')
    expect(capNudge({ ownerTier: 'pro', createdAt: NEW, override: null })).toBe('upgrade')
    expect(capNudge({ ownerTier: 'studio', createdAt: NEW, override: null })).toBe('none')
  })

  it('says nothing at all for a hand-set ceiling', () => {
    for (const tier of [null, 'free', 'pro', 'studio'] as const) {
      expect(capNudge({ ownerTier: tier, createdAt: NEW, override: 30_000 }), String(tier)).toBe('none')
    }
  })

  it('never suggests registering to somebody who is already registered', () => {
    for (const tier of ['free', 'pro', 'studio'] as const) {
      expect(capNudge({ ownerTier: tier, createdAt: OLD, override: null })).not.toBe('register')
      expect(capNudge({ ownerTier: tier, createdAt: NEW, override: null })).not.toBe('register')
    }
  })
})
