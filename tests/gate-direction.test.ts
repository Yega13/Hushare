import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A PLAN GATE MUST ONLY RUN IN ONE DIRECTION: it may refuse to turn a paid feature ON, and it must
// never refuse to turn one OFF.
//
// This is not a style rule. Several routes checked the plan before the update regardless of which
// way the setting was moving, so an owner who was not on the plan any more — or who had set the
// thing while it was ungated — could not undo it. Found live on real albums: a free account with a
// custom logo it could not remove, another with sponsor logos and Face Finder indexing it could not
// switch off. The countdown reveal was the dangerous one: a future reveal date keeps the album
// SEALED, so freezing that setting locks an owner out of their own album until the clock runs out.
//
// api/album/branding and api/album/media-settings always had this right and say why in their own
// comments; the rest were brought into line. This pins all of them, because the failure is silent —
// nothing errors, nothing logs, and the owner simply cannot undo a choice.
//
// Each entry names the guard that must still surround the check. If a route is refactored, update
// the pattern deliberately — do not delete the entry to make the test pass.
const OFF_SWITCH_GUARDS: Record<string, RegExp> = {
  'api/album/reveal/route.ts': /if \(revealAt !== null\) \{[\s\S]{0,200}?refuseBelowTier/,
  'api/album/logo/route.ts': /if \(value !== null\) \{[\s\S]{0,200}?refuseBelowTier/,
  'api/album/sponsors/route.ts': /if \(addsSomething\) \{[\s\S]{0,200}?refuseBelowTier/,
  'api/album/bib-search/route.ts': /if \(enabled\) \{[\s\S]{0,200}?refuseBelowTier/,
  'api/album/custom-url/route.ts': /if \(newCustomSlug !== null\) \{[\s\S]{0,300}?Custom URLs require a Pro or Max plan/,
  'api/album/face-finder/route.ts': /if \(enabled\) \{[\s\S]{0,400}?Face Finder requires a Max plan/,
  'api/album/branding/route.ts': /if \(hide\) \{[\s\S]{0,300}?requires a Pro or Max plan/,
  'api/album/media-settings/route.ts': /if \(updates\.require_approval === true\) \{[\s\S]{0,200}?refuseBelowTier/,
}

// A COLLABORATION ALBUM KEEPS THE HUSHARE MARK, and that has to hold in two places.
//
// These albums are given Max for free in exchange for carrying our name in front of everyone who
// opens them, so the mark is the consideration in the deal. Max includes "remove Hushare branding"
// as one toggle. Refusing the write is not enough on its own: hide_branding has already once
// survived a cancelled subscription forever because nothing re-checked it at READ time, and a
// value stored before a lock would do exactly the same thing.
describe('a collaboration album cannot hide the Hushare mark', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8')

  it('refuses the write while the album is locked', () => {
    const source = read('app/api/album/branding/route.ts')
    expect(
      /if \(hide && access\.album\.branding_locked\)/.test(source),
      'api/album/branding must refuse to hide the mark on a locked album',
    ).toBe(true)
  })

  it('forces the mark back on when the album is read', () => {
    const source = read('lib/server/album-access.ts')
    expect(
      // `.` already stops at a newline, so this stays on one line without needing an escape that
      // a shell or script could eat on the way to disk — see tests/source-hygiene.test.ts.
      /hide_branding:.*!album\.branding_locked/.test(source),
      'resolveAlbum must AND !branding_locked into hide_branding, so a value stored before the ' +
        'lock cannot keep taking effect',
    ).toBe(true)
  })
})

describe('a plan gate never blocks turning a feature off', () => {
  for (const [route, guard] of Object.entries(OFF_SWITCH_GUARDS)) {
    it(`${route} gates only the "on" direction`, () => {
      const source = readFileSync(join(process.cwd(), 'src', 'app', ...route.split('/')), 'utf8')
      expect(
        guard.test(source),
        `${route}: the plan check is no longer wrapped in a guard that limits it to turning the ` +
          `feature ON. An owner off the plan must always be able to switch it back off.`,
      ).toBe(true)
    })
  }
})
