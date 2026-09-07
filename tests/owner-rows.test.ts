import { describe, it, expect } from 'vitest'
import { ownerRows, type OwnerRowsInput, type RowLook } from '@/lib/owner-rows'
import { FEATURE_TIER } from '@/lib/plan-gates'

// WHAT A GIVEN OWNER SEES IN THE TOOLBAR. Each case is a real owner: a free owner, a Pro owner, a
// Max owner, an owner whose tier has not loaded yet, an owner whose album carries a live package.
// The rows used to compose these answers inline, four booleans at a time, where no test could ask.

const base: OwnerRowsInput = { tier: 'free', packagedLive: false, collectionsEnabled: false, brandingLocked: false, guestUploadsEnabled: true }
const look = (over: Partial<OwnerRowsInput>) => ownerRows({ ...base, ...over })

const LIVE: RowLook = { show: true, dimmed: false, enabled: true }
const LOCKED: RowLook = { show: true, dimmed: true, enabled: false }
const PENDING: RowLook = { show: true, dimmed: false, enabled: false }
const HIDDEN: RowLook = { show: false, dimmed: true, enabled: false }

describe('a free owner on an ordinary album sees every paid row greyed with its badge, never hidden', () => {
  it('custom URL, moderation, branding, face finder are locked; collections locked', () => {
    const r = look({ tier: 'free' })
    expect(r.customUrl).toEqual(LOCKED)
    expect(r.moderation).toEqual(LOCKED)
    expect(r.branding).toEqual(LOCKED)
    expect(r.faceFinder).toEqual(LOCKED)
    expect(r.collections).toEqual(LOCKED)
    expect(Object.values(r).every((row) => row.show), 'a free owner must SEE what Pro buys').toBe(true)
  })
  it('bib search only disables its control, and the live wall button stays usable -- as the product does today', () => {
    const r = look({ tier: 'free' })
    expect(r.bibSearch).toEqual(PENDING)
    expect(r.liveWall).toEqual(LIVE)
  })
})

describe('a Pro owner', () => {
  it('has every Pro row live and the Max-only rows locked', () => {
    const r = look({ tier: 'pro' })
    for (const [key, feature] of [['customUrl', 'customUrl'], ['moderation', 'photoModeration'], ['branding', 'hideBranding'], ['faceFinder', 'faceFinder']] as const) {
      expect(r[key], key).toEqual(FEATURE_TIER[feature] === 'pro' ? LIVE : LOCKED)
    }
    expect(r.bibSearch).toEqual(FEATURE_TIER.bibSearch === 'pro' ? LIVE : PENDING)
  })
})

describe('a Max owner has everything live', () => {
  it('every plan-gated row is live; collections still follow the account answer', () => {
    const r = look({ tier: 'studio', collectionsEnabled: true })
    for (const key of ['customUrl', 'moderation', 'branding', 'faceFinder', 'bibSearch', 'liveWall', 'collections'] as const) {
      expect(r[key], key).toEqual(LIVE)
    }
  })
})

describe('while the tier is still loading, rows are PLAIN and inert -- no badge that then vanishes', () => {
  it('nothing is dimmed, nothing is enabled, everything is shown', () => {
    const r = look({ tier: null })
    for (const key of ['customUrl', 'moderation', 'branding', 'faceFinder', 'bibSearch'] as const) {
      expect(r[key], key).toEqual(PENDING)
    }
    expect(r.liveWall).toEqual(LIVE)
  })
})

describe('a LIVE PACKAGE hides what it does not include instead of upselling it', () => {
  it('a free owner with a Pro package: Pro rows live, Max-only rows HIDDEN, nothing greyed', () => {
    // The owner's rule: "in packages don't show anything that is unaccessible."
    const r = look({ tier: 'pro', packagedLive: true })
    expect(r.customUrl).toEqual(LIVE)
    expect(r.moderation).toEqual(LIVE)
    for (const [key, feature] of [['faceFinder', 'faceFinder'], ['liveWall', 'liveWall']] as const) {
      expect(r[key], key).toEqual(FEATURE_TIER[feature] === 'pro' ? LIVE : HIDDEN)
    }
    expect(r.collections, 'collections are account-scoped; a package hides them when the account lacks them').toEqual(HIDDEN)
    expect(Object.values(r).some((row) => row.show && row.dimmed), 'a packaged album must never show a greyed upsell row').toBe(false)
  })
  it('an EXPIRED package is an ordinary album again: greyed rows, not hidden ones', () => {
    const r = look({ tier: 'free', packagedLive: false })
    expect(r.faceFinder).toEqual(LOCKED)
  })
})

describe('moderation is only meaningful while guests can add photos', () => {
  it('with guest uploads off, the switch is dimmed and disabled even for a Pro owner', () => {
    expect(look({ tier: 'pro', guestUploadsEnabled: false }).moderation).toEqual({ show: true, dimmed: true, enabled: false })
  })
  it('the plan verdict wins over the moot verdict: a free owner sees LOCKED, and on a package sees nothing', () => {
    expect(look({ tier: 'free', guestUploadsEnabled: false }).moderation).toEqual(LOCKED)
    expect(look({ tier: 'free', guestUploadsEnabled: false, packagedLive: true }).moderation).toEqual(HIDDEN)
  })
  it('does not touch any other row', () => {
    const on = look({ tier: 'pro', guestUploadsEnabled: true })
    const off = look({ tier: 'pro', guestUploadsEnabled: false })
    expect({ ...off, moderation: on.moderation }).toEqual(on)
  })
})

describe('branding held on by a collaboration', () => {
  it('is dimmed and disabled for a Pro owner, and still SHOWN -- the copy explains the collaboration', () => {
    expect(look({ tier: 'pro', brandingLocked: true }).branding).toEqual({ show: true, dimmed: true, enabled: false })
  })
  it('a free owner still sees the plan lock, and a packaged free owner sees nothing', () => {
    expect(look({ tier: 'free', brandingLocked: true }).branding).toEqual(LOCKED)
    expect(look({ tier: 'free', brandingLocked: true, packagedLive: true }).branding).toEqual(HIDDEN)
  })
})

describe('collections follow the account, not the album tier', () => {
  it('a Max album whose account lacks collections shows the row locked', () => {
    expect(look({ tier: 'studio', collectionsEnabled: false }).collections).toEqual(LOCKED)
  })
  it('a free album whose account has collections shows the row live', () => {
    expect(look({ tier: 'free', collectionsEnabled: true }).collections).toEqual(LIVE)
  })
})
