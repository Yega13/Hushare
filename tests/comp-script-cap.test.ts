import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_MEDIA_CAP_OVERRIDE } from '@/lib/album-entitlements'
import { validateCap } from '../scripts/comp-cap-validate.mjs'

// THE ONE NUMBER THE COMP SCRIPT COPIES.
//
// scripts/comp-album-cap.mjs sets albums.media_cap_override by hand — the lever that outranks every
// tier, package and grandfathering rule. It cannot import MAX_MEDIA_CAP_OVERRIDE, because it is a
// plain .mjs run with node against the production database and the constant lives in TypeScript.
// So the ceiling is written twice, which is exactly the shape rule 13 exists to catch: if the real
// ceiling ever drops and the script keeps the old one, the script becomes the way to create the
// unbounded-cost album that the ceiling was added to make impossible.
//
// This reads the real constant and the script's literal, and fails if they part company.
describe('the comp script cannot outrun the real ceiling', () => {
  it('scripts/comp-album-cap.mjs uses the same MAX as lib/album-entitlements', () => {
    const src = readFileSync(join(process.cwd(), 'scripts', 'comp-album-cap.mjs'), 'utf8')
    const m = src.match(/const MAX_CAP = ([\d_]+)/)
    expect(m, 'the script must declare MAX_CAP as a literal this test can read').not.toBeNull()
    const scriptMax = Number((m as RegExpMatchArray)[1].replace(/_/g, ''))
    expect(
      scriptMax,
      'scripts/comp-album-cap.mjs MAX_CAP has drifted from MAX_MEDIA_CAP_OVERRIDE — the script ' +
      'would then accept a ceiling the application refuses to honour, or worse, one it does',
    ).toBe(MAX_MEDIA_CAP_OVERRIDE)
  })
})

describe('the comp script actually ENFORCES that ceiling', () => {
  // The block above pins the script's MAX_CAP to the real constant. It said nothing about the code
  // that uses it: a mutation replacing the entire bound check with `if (false)` left the suite
  // green, so the script would have accepted any number at all — on the one lever that outranks
  // every tier, package and grandfathering rule. Rule 15: the constant and its enforcement.
  it('refuses a cap above the ceiling', () => {
    expect(validateCap(MAX_MEDIA_CAP_OVERRIDE + 1, MAX_MEDIA_CAP_OVERRIDE)).toBeTruthy()
    expect(validateCap(999_999_999, MAX_MEDIA_CAP_OVERRIDE)).toBeTruthy()
  })

  it('refuses zero, negatives and fractions', () => {
    expect(validateCap(0, MAX_MEDIA_CAP_OVERRIDE)).toBeTruthy()
    expect(validateCap(-5, MAX_MEDIA_CAP_OVERRIDE)).toBeTruthy()
    expect(validateCap(1.5, MAX_MEDIA_CAP_OVERRIDE)).toBeTruthy()
  })

  it('refuses what is not a number at all', () => {
    expect(validateCap('lots', MAX_MEDIA_CAP_OVERRIDE)).toBeTruthy()
    expect(validateCap('', MAX_MEDIA_CAP_OVERRIDE)).toBeTruthy()
    expect(validateCap(undefined, MAX_MEDIA_CAP_OVERRIDE)).toBeTruthy()
  })

  it('allows the ceiling itself and ordinary values', () => {
    expect(validateCap(MAX_MEDIA_CAP_OVERRIDE, MAX_MEDIA_CAP_OVERRIDE)).toBeNull()
    expect(validateCap(1, MAX_MEDIA_CAP_OVERRIDE)).toBeNull()
    expect(validateCap(10_000, MAX_MEDIA_CAP_OVERRIDE)).toBeNull()
  })
})
