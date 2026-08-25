import { describe, it, expect } from 'vitest'
import { planFeatures } from '@/lib/plan-features'
import { en } from '@/i18n/dictionaries/en'
import { ru } from '@/i18n/dictionaries/ru'
import { hy } from '@/i18n/dictionaries/hy'
import {
  albumCountLimitForTier,
  albumMediaCapForTier,
  uploadCapsForTier,
  formatCapSize,
} from '@/lib/media'

// What a plan CLAIMS to include has to match what the server actually gates, and these lists are
// read by someone at the moment they hand over money — the worst possible place to overstate.
//
// The hand-written lists this replaced advertised "Max Collections" on the Pro card (Collections
// are studio-only) and "Password protection" on both paid cards (free albums have always had it),
// while the free card quoted a 250-item cap the server had long stopped using. Every one of those
// is a promise that could not be kept or a giveaway of something already free, and none of it was
// caught because nothing tied the copy to the code.

const keys = (tier: Parameters<typeof planFeatures>[0], isAdmin = false) =>
  planFeatures(tier, isAdmin).map((f) => f.key)

describe('plan features describe what is actually gated', () => {
  it('never sells a free feature as a paid one', () => {
    // These are not gated anywhere on the server, so no paid plan may take credit for them.
    const freeForEveryone = ['plan.password', 'plan.photoWall', 'plan.qr']
    for (const tier of ['pro', 'studio'] as const) {
      for (const k of freeForEveryone) {
        expect(keys(tier), `${tier} must not advertise ${k}`).not.toContain(k)
      }
    }
  })

  it('keeps studio-only features off the Pro card', () => {
    // app/c/[slug] and api/album/face-* both require tier === 'studio'.
    expect(keys('pro')).not.toContain('plan.collections')
    expect(keys('pro')).not.toContain('plan.faceFinder')
    expect(keys('studio')).toContain('plan.collections')
    expect(keys('studio')).toContain('plan.faceFinder')
  })

  it('only names paid perks the server enforces', () => {
    // api/album/custom-url and api/album/branding both reject tier === 'free'.
    expect(keys('pro')).toContain('plan.customUrl')
    expect(keys('pro')).toContain('plan.noBranding')
    expect(keys('free')).not.toContain('plan.customUrl')
    expect(keys('free')).not.toContain('plan.noBranding')
  })

  it('quotes the limits the server enforces, not copied numbers', () => {
    for (const tier of ['free', 'pro', 'studio'] as const) {
      const features = planFeatures(tier)
      const albums = features.find((f) => f.key === 'plan.albums')
      const perAlbum = features.find((f) => f.key === 'plan.perAlbum')
      const uploads = features.find((f) => f.key === 'plan.uploads')
      expect(albums?.vars?.n).toBe(albumCountLimitForTier(tier))
      expect(perAlbum?.vars?.n).toBe(albumMediaCapForTier(tier))
      expect(uploads?.vars?.photo).toBe(formatCapSize(uploadCapsForTier(tier).image))
      expect(uploads?.vars?.video).toBe(formatCapSize(uploadCapsForTier(tier).video))
    }
  })

  it('gives every tier a higher allowance than the one below', () => {
    const cap = (t: Parameters<typeof planFeatures>[0]) => albumMediaCapForTier(t)
    expect(cap('pro')).toBeGreaterThan(cap('free'))
    expect(cap('studio')).toBeGreaterThan(cap('pro'))
    expect(albumCountLimitForTier('pro')).toBeGreaterThan(albumCountLimitForTier('free'))
    expect(albumCountLimitForTier('studio')).toBeGreaterThan(albumCountLimitForTier('pro'))
    expect(uploadCapsForTier('studio').video).toBeGreaterThan(uploadCapsForTier('pro').video)
    expect(uploadCapsForTier('pro').video).toBeGreaterThan(uploadCapsForTier('free').video)
  })

  it('has a string for every key it emits, in every language', () => {
    const all = new Set<string>()
    for (const tier of ['free', 'pro', 'studio'] as const) keys(tier).forEach((k) => all.add(k))
    keys('studio', true).forEach((k) => all.add(k))

    for (const k of all) {
      // English is the source dictionary and MUST have every key — ru/hy fall back to it, so a
      // missing translation degrades to English rather than showing a raw key like "plan.albums".
      expect(en, `en is missing ${k}`).toHaveProperty(k)
      for (const [name, dict] of [['ru', ru], ['hy', hy]] as const) {
        const value = (dict as Record<string, string>)[k]
        if (value === undefined) continue
        // A translation that drops a placeholder would silently print nothing where a number
        // belongs — worse than being untranslated.
        const placeholders = [...String(en[k as keyof typeof en]).matchAll(/\{(\w+)\}/g)].map((m) => m[1])
        for (const ph of placeholders) {
          expect(value, `${name}.${k} lost the {${ph}} placeholder`).toContain(`{${ph}}`)
        }
      }
    }
  })

  it('has no gaps in the pricing feature keys', () => {
    // The pricing page renders features BY POSITION — `tt(\`pricing.\${tier}.f\${i + 1}\`)` — so a
    // key that is missing from the middle of the run renders the literal string "pricing.pro.f7" on
    // a public page. Nothing throws; it just says that to a customer. A gap is the only way to get
    // there, so a gap is what this checks.
    for (const [name, dict] of [['en', en], ['ru', ru], ['hy', hy]] as const) {
      // A LITERAL regex, not one built from a template string. The first version of this test used
      // new RegExp(`^pricing\.${tier}\.f(\d+)$`) — inside a template literal `\d` collapses to a
      // plain "d", so the pattern matched nothing, every tier hit the `continue` below, and the test
      // passed while checking absolutely nothing. A test that cannot fail is worse than no test,
      // because it is counted as coverage.
      const KEY = /^pricing\.(free|pro|max)\.f(\d+)$/
      for (const tier of ['free', 'pro', 'max']) {
        const nums = Object.keys(dict)
          .map((k) => KEY.exec(k))
          .filter((m): m is RegExpExecArray => m !== null && m[1] === tier)
          .map((m) => Number(m[2]))
          .sort((a, b) => a - b)
        if (nums.length === 0) continue // ru/hy only override some keys; English is the source
        expect(nums[0], `${name}.${tier} should start at f1`).toBe(1)
        for (let i = 0; i < nums.length; i++) {
          expect(nums[i], `${name}.${tier} has a gap before f${nums[i]}`).toBe(i + 1)
        }
      }
    }
  })
})
