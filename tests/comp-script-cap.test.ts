import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_MEDIA_CAP_OVERRIDE } from '@/lib/album-entitlements'

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
