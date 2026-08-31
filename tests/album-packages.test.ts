import { describe, it, expect } from 'vitest'
import {
  albumEffectiveTier, packageExpired, albumCap, videoCaps, type AlbumPackage,
} from '../src/lib/album-entitlements'
import {
  PACKAGE_CATALOGUE, RENEWAL_CATALOGUE, extendExpiry, isPackageKey, isRenewalKey,
} from '../src/lib/package-catalogue'
import { PRO_ALBUM_MEDIA, STUDIO_ALBUM_MEDIA, FREE_ALBUM_MEDIA } from '../src/lib/media'

const NOW = new Date('2026-09-01T12:00:00Z')
const LIVE = '2028-09-01T12:00:00Z'    // two years out
const DEAD = '2026-08-01T12:00:00Z'    // a month ago

const pkg = (tier: 'pro' | 'studio' | null, expiresAt: string | null): AlbumPackage => ({ tier, expiresAt })

describe('albumEffectiveTier — the better of the two, never the average', () => {
  it('gives a FREE account the tier it paid for on that album', () => {
    // The whole reason this function exists. Every feature gate asks the OWNER's tier today, which
    // would hand a paying package customer the free feature set because their account carries no
    // subscription. Somebody who paid $99 for a Max Package must get Max on that album.
    expect(albumEffectiveTier('free', pkg('studio', LIVE), NOW)).toBe('studio')
    expect(albumEffectiveTier(null, pkg('pro', LIVE), NOW)).toBe('pro')
  })

  it('never DEMOTES an album below its owner subscription', () => {
    // A Max subscriber who buys a Pro Package for one album must not lose Max on it.
    expect(albumEffectiveTier('studio', pkg('pro', LIVE), NOW)).toBe('studio')
  })

  it('falls back to the owner when the package has lapsed', () => {
    expect(albumEffectiveTier('free', pkg('studio', DEAD), NOW)).toBe('free')
    expect(albumEffectiveTier('pro', pkg('studio', DEAD), NOW)).toBe('pro')
  })

  it('is just the owner tier when no package was ever bought', () => {
    expect(albumEffectiveTier('free', null, NOW)).toBe('free')
    expect(albumEffectiveTier('pro', undefined, NOW)).toBe('pro')
    expect(albumEffectiveTier(null, pkg(null, null), NOW)).toBe('free')
  })
})

describe('packageExpired — an unreadable date must not grant features forever', () => {
  it('treats a missing or broken expiry as expired', () => {
    // Erring toward expired only ever switches FEATURES off and never touches data: the album
    // falls back to its owner's tier and keeps every photo. Erring the other way would grant paid
    // features indefinitely off a corrupt string.
    expect(packageExpired(pkg('pro', null), NOW)).toBe(true)
    expect(packageExpired(pkg('pro', 'not a date'), NOW)).toBe(true)
    expect(packageExpired(null, NOW)).toBe(true)
    expect(packageExpired(pkg(null, LIVE), NOW)).toBe(true)
  })

  it('is not expired one second early, and is expired on the stroke', () => {
    expect(packageExpired(pkg('pro', '2026-09-01T12:00:01Z'), NOW)).toBe(false)
    expect(packageExpired(pkg('pro', '2026-09-01T12:00:00Z'), NOW)).toBe(true)
  })
})

describe('albumCap — a package raises the item allowance and never lowers it', () => {
  const base = { createdAt: '2026-09-01T00:00:00Z', override: null, now: NOW }

  it('gives a free owner the package allowance they bought', () => {
    // A Pro PACKAGE grants 5,000 where a Pro SUBSCRIPTION grants 3,000 — the package carries its
    // own number, so effective tier alone would under-serve it.
    expect(albumCap({ ...base, ownerTier: 'free', pkg: pkg('pro', LIVE) }).cap)
      .toBe(PACKAGE_CATALOGUE.package_pro.items)
    expect(albumCap({ ...base, ownerTier: 'free', pkg: pkg('studio', LIVE) }).cap)
      .toBe(PACKAGE_CATALOGUE.package_max.items)
  })

  it('NEVER lowers an album that already had more', () => {
    // A Max subscriber (10,000) who buys a Pro Package (5,000) must keep 10,000. The package joins
    // the same max() as grandfathering: nothing in this function may ever subtract.
    expect(albumCap({ ...base, ownerTier: 'studio', pkg: pkg('pro', LIVE) }).cap).toBe(STUDIO_ALBUM_MEDIA)
    expect(albumCap({ ...base, ownerTier: 'pro', pkg: pkg('pro', LIVE) }).cap)
      .toBeGreaterThanOrEqual(PRO_ALBUM_MEDIA)
  })

  it('a hand-set override still outranks everything, including a package', () => {
    expect(albumCap({ ...base, ownerTier: 'free', pkg: pkg('studio', LIVE), override: 30_000 }).cap).toBe(30_000)
  })

  it('an EXPIRED package stops raising the cap', () => {
    expect(albumCap({ ...base, ownerTier: 'free', pkg: pkg('studio', DEAD) }).cap).toBe(FREE_ALBUM_MEDIA)
  })

  it('names the package as the reason, so the refusal message can be honest', () => {
    expect(albumCap({ ...base, ownerTier: 'free', pkg: pkg('studio', LIVE) }).reason).toBe('package')
    expect(albumCap({ ...base, ownerTier: 'studio', pkg: pkg('pro', LIVE) }).reason).toBe('plan')
  })
})

describe('video budget follows the effective tier', () => {
  it('a package album gets its tier video allowance', () => {
    // Not asserted through albumCap — videoCaps takes a tier, so the CALLER must pass the
    // effective one. This pins the pairing so a route cannot pass the owner's tier by habit.
    const tier = albumEffectiveTier('free', pkg('studio', LIVE), NOW)
    expect(videoCaps(tier)).toEqual(videoCaps('studio'))
    expect(videoCaps(albumEffectiveTier('free', pkg('studio', DEAD), NOW))).toEqual(videoCaps('free'))
  })
})

describe('the catalogue is the prices that were agreed', () => {
  it('holds the closed numbers', () => {
    expect(PACKAGE_CATALOGUE.package_pro.amountCents).toBe(4900)
    expect(PACKAGE_CATALOGUE.package_max.amountCents).toBe(9900)
    expect(RENEWAL_CATALOGUE.renewal_pro.amountCents).toBe(900)
    expect(RENEWAL_CATALOGUE.renewal_max.amountCents).toBe(1900)
  })

  it('includes two years, and renews by one', () => {
    expect(PACKAGE_CATALOGUE.package_pro.years).toBe(2)
    expect(PACKAGE_CATALOGUE.package_max.years).toBe(2)
    expect(RENEWAL_CATALOGUE.renewal_pro.years).toBe(1)
    expect(RENEWAL_CATALOGUE.renewal_max.years).toBe(1)
  })

  it('every renewal a package points at actually exists', () => {
    for (const spec of Object.values(PACKAGE_CATALOGUE)) {
      expect(RENEWAL_CATALOGUE[spec.renewal], spec.label).toBeDefined()
    }
  })

  it('a renewal never costs more than the package it extends', () => {
    for (const spec of Object.values(PACKAGE_CATALOGUE)) {
      expect(RENEWAL_CATALOGUE[spec.renewal].amountCents).toBeLessThan(spec.amountCents)
    }
  })

  it('the Max package gives at least as much as the Pro one, on both axes', () => {
    expect(PACKAGE_CATALOGUE.package_max.items)
      .toBeGreaterThanOrEqual(PACKAGE_CATALOGUE.package_pro.items)
    expect(PACKAGE_CATALOGUE.package_max.amountCents)
      .toBeGreaterThan(PACKAGE_CATALOGUE.package_pro.amountCents)
  })

  it('recognises its own keys and nothing else', () => {
    expect(isPackageKey('package_pro')).toBe(true)
    expect(isPackageKey('renewal_pro')).toBe(false)
    expect(isRenewalKey('renewal_max')).toBe(true)
    for (const junk of ['', 'pro', 'toString', 'constructor', null, 0, {}]) {
      expect(isPackageKey(junk), String(junk)).toBe(false)
      expect(isRenewalKey(junk), String(junk)).toBe(false)
    }
  })
})

describe('extendExpiry — paying early must never cost somebody time', () => {
  it('extends from the CURRENT expiry when the album is still covered', () => {
    // Renewing eleven months early with ten months left must give 22 months, not 12. Extending
    // from "now" would silently confiscate the time they already paid for.
    const left = new Date('2027-07-01T00:00:00Z')
    expect(extendExpiry(left, 1, NOW).toISOString()).toBe('2028-07-01T00:00:00.000Z')
  })

  it('extends from TODAY when it already lapsed', () => {
    // The alternative is selling a year that is already partly spent.
    expect(extendExpiry(new Date(DEAD), 1, NOW).toISOString()).toBe('2027-09-01T12:00:00.000Z')
  })

  it('handles a first purchase with no prior expiry', () => {
    expect(extendExpiry(null, 2, NOW).toISOString()).toBe('2028-09-01T12:00:00.000Z')
  })

  it('always moves forward, never back', () => {
    for (const prior of [null, new Date(DEAD), new Date(LIVE)]) {
      expect(extendExpiry(prior, 1, NOW).getTime()).toBeGreaterThan(NOW.getTime())
    }
  })
})
