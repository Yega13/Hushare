import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAN_CATALOGUE, INTRO_FIRST_MONTH_CENTS, formatPrice } from '../src/lib/plan-catalogue'
import { videoCaps } from '../src/lib/album-entitlements'

// EVERY PRICE A CUSTOMER READS, HELD TO THE ONE THE SYSTEM CHARGES.
//
// This is rule 13's prescribed remedy for a fact that genuinely cannot be imported. The pricing
// page renders its prices from the translation dictionaries — `annual: tt('pricing.pro.annual')` —
// and a dictionary is a flat map of finished sentences, so it cannot import a catalogue and format
// a number. So the copies are TESTED against the real source instead, and this test reads the real
// dictionaries rather than a list of expected strings typed out beside them.
//
// It exists because the numbers had drifted out of anything's reach. tests/plan-catalogue.test.ts
// looked like it guarded them, but it asserts against src/app/pricing/page.tsx — and page.tsx only
// supplies the FALLBACK; the value on screen comes from the dictionary. So `$40 / year` was written
// into en, ru and hy by hand, in eighteen sentences, with nothing checking any of them. Changing
// PLAN_CATALOGUE.pro_yearly and updating page.tsx would have passed the whole suite while every
// visitor in all three languages still read the old price on the page where they decide to pay.
//
// This is the free-video-cap failure again, on the price: English was corrected 50 MB -> 200 MB and
// Russian and Armenian kept 50, so those visitors read a quarter of the truth. The same shape, on
// the number that takes their money.

const LOCALES = ['en', 'ru', 'hy'] as const

function dictSource(locale: string): string {
  return readFileSync(join(process.cwd(), 'src', 'i18n', 'dictionaries', `${locale}.ts`), 'utf8')
}

// The price as it is written in copy, e.g. "$40". Read from the catalogue every time, never typed.
const PRO_MONTH = formatPrice(PLAN_CATALOGUE.pro_monthly.amountCents)
const PRO_YEAR = formatPrice(PLAN_CATALOGUE.pro_yearly.amountCents)
const MAX_MONTH = formatPrice(PLAN_CATALOGUE.studio_monthly.amountCents)
const MAX_YEAR = formatPrice(PLAN_CATALOGUE.studio_yearly.amountCents)
const PRO_INTRO = formatPrice(INTRO_FIRST_MONTH_CENTS.pro)
const MAX_INTRO = formatPrice(INTRO_FIRST_MONTH_CENTS.studio)

/** Every price-bearing key, and which catalogue prices its sentence must contain. */
const PRICE_KEYS: { key: string; must: string[] }[] = [
  { key: 'pricing.pro.annual', must: [PRO_YEAR] },
  { key: 'pricing.max.annual', must: [MAX_YEAR] },
  { key: 'pricing.pro.promo', must: [PRO_INTRO] },
  { key: 'pricing.max.promo', must: [MAX_INTRO] },
  { key: 'pricing.pro.renew', must: [PRO_INTRO, PRO_MONTH] },
  { key: 'pricing.max.renew', must: [MAX_INTRO, MAX_MONTH] },
  { key: 'pricing.faq.a8', must: [PRO_YEAR, MAX_YEAR] },
  { key: 'pricing.faq.a9', must: [PRO_INTRO, PRO_MONTH, MAX_INTRO, MAX_MONTH] },
]

/**
 * The value of one dictionary key, as written in the source file.
 *
 * Read from source rather than by importing the module because the assertion has to be about the
 * literal a translator edits. Quotes inside a sentence are ordinary in all three languages, so the
 * value runs to the end of the line rather than to the first closing quote.
 */
function dictValue(source: string, key: string): string | null {
  const line = source.split(/\r?\n/).find((l) => l.trimStart().startsWith(`'${key}':`))
  if (!line) return null
  const after = line.slice(line.indexOf(':') + 1).trim()
  return after.replace(/,\s*$/, '')
}

describe('the price on the page is the price in the catalogue', () => {
  for (const locale of LOCALES) {
    const source = dictSource(locale)

    for (const { key, must } of PRICE_KEYS) {
      it(`${locale}: ${key} quotes ${must.join(' and ')}`, () => {
        const value = dictValue(source, key)
        // A missing key is a failure, not a skip. Silently passing over a key that has been renamed
        // or deleted is how this kind of test rots into decoration.
        expect(value, `${key} is missing from ${locale}.ts`).not.toBeNull()
        for (const price of must) {
          expect(value, `${locale}.ts ${key} does not contain ${price}`).toContain(price)
        }
      })
    }
  }

  it('no dictionary quotes a price that is NOT in the catalogue', () => {
    // The direction the per-key checks cannot cover. "$40 / year" containing "$40" still passes if
    // someone ALSO leaves a stale "$35" in the same sentence, and a reader believes the wrong one.
    const known = new Set([PRO_MONTH, PRO_YEAR, MAX_MONTH, MAX_YEAR, PRO_INTRO, MAX_INTRO])
    const offenders: string[] = []
    for (const locale of LOCALES) {
      const source = dictSource(locale)
      for (const { key } of PRICE_KEYS) {
        const value = dictValue(source, key) ?? ''
        for (const found of value.match(/\$\d+(?:\.\d{2})?/g) ?? []) {
          if (!known.has(found)) offenders.push(`${locale} ${key}: ${found}`)
        }
      }
    }
    expect(offenders, `prices in copy that no plan charges:\n${offenders.join('\n')}`).toEqual([])
  })
})

describe('the intro prices are a real discount', () => {
  it('costs less than the standard month, or it is not an offer', () => {
    expect(INTRO_FIRST_MONTH_CENTS.pro).toBeLessThan(PLAN_CATALOGUE.pro_monthly.amountCents)
    expect(INTRO_FIRST_MONTH_CENTS.studio).toBeLessThan(PLAN_CATALOGUE.studio_monthly.amountCents)
  })

  it('is not free — a 100% intro would hand out a month of Max for nothing', () => {
    expect(INTRO_FIRST_MONTH_CENTS.pro).toBeGreaterThan(0)
    expect(INTRO_FIRST_MONTH_CENTS.studio).toBeGreaterThan(0)
  })
})

describe('the video limit is actually advertised', () => {
  // IT WAS ENFORCED AND NEVER MENTIONED. The upload route refuses a video once the album's minute
  // pool is spent, and no plan on /pricing said the pool existed. A customer could buy Pro for a
  // wedding, upload twenty minutes of video, and meet a wall nothing had ever disclosed — at the
  // event, which is the only time they would find out.
  //
  // The page interpolates these from videoCaps, so this test is about the SENTENCE still being
  // there: an interpolated number cannot go stale, but a line can be deleted in a redesign and
  // nobody would notice the limit had gone quiet again.
  for (const locale of LOCALES) {
    const source = dictSource(locale)

    it(`${locale}: every plan states its per-album video minutes`, () => {
      for (const [key, token] of [
        ['pricing.free.f4', '{freeVideoMin}'],
        ['pricing.pro.f5', '{proVideoMin}'],
        ['pricing.max.f7', '{maxVideoMin}'],
      ] as const) {
        const value = dictValue(source, key)
        expect(value, `${key} is missing from ${locale}.ts`).not.toBeNull()
        expect(value, `${locale}.ts ${key} no longer states the album video allowance`).toContain(token)
      }
    })
  }

  it('the numbers on the page are the ones the upload route enforces', () => {
    // Whole minutes, so the page never has to say "20.5 minutes" — and so a future cap in seconds
    // that does not divide cleanly is caught here rather than rendering a fraction to a customer.
    for (const tier of ['free', 'pro', 'studio'] as const) {
      const seconds = videoCaps(tier).maxTotalSeconds
      expect(seconds % 60, `${tier} video budget is not a whole number of minutes`).toBe(0)
      expect(seconds, tier).toBeGreaterThan(0)
    }
  })

  it('a higher plan never advertises less video than a lower one', () => {
    expect(videoCaps('pro').maxTotalSeconds).toBeGreaterThanOrEqual(videoCaps('free').maxTotalSeconds)
    expect(videoCaps('studio').maxTotalSeconds).toBeGreaterThanOrEqual(videoCaps('pro').maxTotalSeconds)
  })
})
