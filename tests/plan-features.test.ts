import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
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
    // plan.photoWall USED TO BE ON THIS LIST and is deliberately not any more: app/wall/[slug] now
    // requires Max. Anything added here must be checked against GATED_ROUTES below, not assumed.
    const freeForEveryone = ['plan.password', 'plan.qr']
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The lists above are only honest while they track the gates the SERVER enforces, and the gates
// move. The live photo wall was ungated when planFeatures was written, so it was listed as a free
// feature; app/wall/[slug] later started requiring Max and nothing here noticed. The free plan then
// spent that whole time promising, on the account page, a page the product refuses to open.
//
// So this does not check a copied list against another copied list. It READS THE ROUTES, finds
// every tier gate in them, and fails if a gate exists that this file has never been told about.
// Adding a gate now forces a decision: which plan advertises it, or explicitly nothing.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// Every way a gate is currently written. Two idioms exist — the refuseBelowTier/albumHasTier
// helpers, and hand-rolled comparisons that predate them — and both must be found, because a gate
// that this regex misses is a gate the test cannot protect.
const GATE_PATTERNS = [
  /refuseBelowTier\([^)]*?['"](pro|studio)['"]/g,
  /albumHasTier\([^)]*?['"](pro|studio)['"]/g,
  /tier\s*===\s*['"]free['"]/g,
  /tier\s*!==\s*['"]studio['"]/g,
  /\)\)\s*!==\s*['"]studio['"]/g,
  /\)\)\s*===\s*['"]studio['"]/g,
]

// route file (posix, relative to src/app) → the plan-feature key that sells it, or null when the
// gate is deliberately not a bullet on any plan card.
const GATED_ROUTES: Record<string, string | null> = {
  'api/album/logo/route.ts': 'plan.logo',
  'api/album/media-settings/route.ts': 'plan.moderation',
  'api/album/reveal/route.ts': 'plan.reveal',
  'api/album/custom-url/route.ts': 'plan.customUrl',
  'api/album/branding/route.ts': 'plan.noBranding',
  'api/album/sponsors/route.ts': 'plan.sponsors',
  'api/album/bib-search/route.ts': 'plan.bibSearch',
  'api/album/face-finder/route.ts': 'plan.faceFinder',
  'api/album/face-search/route.ts': 'plan.faceFinder',
  'api/album/face-index/route.ts': 'plan.faceFinder',
  'wall/[slug]/page.tsx': 'plan.photoWall',
  'c/[slug]/page.tsx': 'plan.collections',
}

// Which plan each key belongs to, so "listed on the right card" is checkable rather than assumed.
const SOLD_BY: Record<string, 'pro' | 'studio'> = {
  'plan.logo': 'pro',
  'plan.moderation': 'pro',
  'plan.reveal': 'pro',
  'plan.customUrl': 'pro',
  'plan.noBranding': 'pro',
  'plan.sponsors': 'studio',
  'plan.bibSearch': 'studio',
  'plan.faceFinder': 'studio',
  'plan.photoWall': 'studio',
  'plan.collections': 'studio',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('the plan lists track the gates the server actually enforces', () => {
  const appDir = join(process.cwd(), 'src', 'app')
  const gatedFiles = walk(appDir)
    .filter((f) => GATE_PATTERNS.some((re) => { re.lastIndex = 0; return re.test(readFileSync(f, 'utf8')) }))
    .map((f) => f.slice(appDir.length + 1).split(sep).join('/'))

  it('finds the gates at all', () => {
    // A guard on the guard: if the patterns ever stop matching, every assertion below would pass
    // vacuously while checking nothing — the same way the pricing-key regex once did.
    expect(gatedFiles.length).toBeGreaterThanOrEqual(10)
  })

  it('knows about every gated route in src/app', () => {
    const unknown = gatedFiles.filter((f) => !(f in GATED_ROUTES))
    expect(
      unknown,
      `New tier gate(s) with no decision recorded. Add each to GATED_ROUTES in this file — map it ` +
        `to the plan-feature key that sells it, or to null if no plan card mentions it.`,
    ).toEqual([])
  })

  it('lists every gated feature on the plan that unlocks it, and no lower one', () => {
    for (const [route, key] of Object.entries(GATED_ROUTES)) {
      if (key === null) continue
      const tier = SOLD_BY[key]
      expect(tier, `${key} (${route}) has no entry in SOLD_BY`).toBeDefined()
      expect(keys(tier), `${tier} must advertise ${key} — ${route} gates it`).toContain(key)
      expect(keys('free'), `free must not advertise ${key} — ${route} gates it`).not.toContain(key)
      if (tier === 'studio') {
        expect(keys('pro'), `pro must not advertise ${key} — ${route} is Max-only`).not.toContain(key)
      }
    }
  })
})
