import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// A RATCHET, NOT A STANDARD.
//
// This file does not assert that the architecture is good. It asserts that it does not get worse.
//
// The problem it guards is measured, not felt: on 2026-08-30 src/components held 18,914 lines
// behind 7 tests while src/lib held 6,616 behind 139, and every defect two adversarial reviews
// found that week was in a component or a route handler — none in lib. Big components are where
// decisions hide, and a decision nothing can ask about is a bug nobody can see.
//
// Fixing that is months of work. Stopping it getting worse is one file. The numbers below are the
// state on the day it was written; they may go DOWN freely and every reduction should be recorded
// here. Raising one is allowed — some features really are big — but it must be a deliberate line
// in a commit rather than a file quietly growing by forty lines a week for a year, which is how
// every one of these got to its current size.

// NEWLINE via fromCharCode, with no backslash anywhere in this file.
//
// The first version wrote the escape directly and it was mangled on the way to disk, leaving a
// real line break inside a string literal and a file that would not parse. That is the same
// failure tests/source-hygiene.test.ts exists for, and the cheapest way to be immune to it is to
// not need an escape.
const NEWLINE = String.fromCharCode(10)

function lineCount(rel: string): number {
  const text = readFileSync(join(process.cwd(), rel), 'utf8')
  // Counted the way the budgets were measured (`grep -c ""`): the number of newlines. split()
  // returns one MORE than that when a file ends in a newline, and every file here does — without
  // this correction all ten budgets are off by one and fail on the first run.
  return text.split(NEWLINE).length - (text.endsWith(NEWLINE) ? 1 : 0)
}

// The files already too large to reason about. Ratcheted so they can only shrink.
const SIZE_BUDGET: Record<string, number> = {
  // +4 on 2026-08-30: FILE_ACCEPT stopped being a fourth hand-written copy of the accepted
  // MIME types and now builds from lib/media. An import and a comment cost four lines here
  // and removed a list that had already fallen two formats behind. Deliberate.
  'src/components/UploadZone.tsx': 2800,
  // +3 on 2026-08-30: the branding toggle gained a real plan check (it was dimmed but still
  // clickable), and Face Finder and bib search stopped riding on the collections flag. Three
  // lines of reasoning for three gates that were wrong. Deliberate.
  'src/components/OwnerToolbar.tsx': 1783,
  'src/app/[slug]/AlbumPageClient.tsx': 1450,
  'src/app/card-editor/CardEditorClient.tsx': 873,
  'src/components/PhotoGrid.tsx': 843,
  'src/components/AlbumDesigner.tsx': 774,
  'src/app/admin/page.tsx': 767,
  'src/components/photo-grid/LightboxOverlay.tsx': 646,
  // 518, down from 645: validatePhoto, hasTraversal and r2UrlPrefix moved to lib/photo-input,
  // where 22 tests now cover the boundary between a guest and this album's storage — including the
  // poisoned-thumbnail attack, which the mutation run confirmed they catch.
  'src/app/api/album/photos/create/route.ts': 518,
  'src/components/FaceFinder.tsx': 542,
}

describe('the big files do not get bigger', () => {
  for (const [file, budget] of Object.entries(SIZE_BUDGET)) {
    it(`${file.replace('src/', '')} stays within ${budget} lines`, () => {
      const actual = lineCount(file)
      expect(
        actual,
        `${file} is ${actual} lines, budget ${budget}. If this growth is deliberate, raise the ` +
          `number here in the same commit — that is the whole point, the growth should be visible. ` +
          `If it is not, the new logic probably belongs in src/lib where it can be tested.`,
      ).toBeLessThanOrEqual(budget)
    })
  }

  it('records a reduction rather than leaving slack', () => {
    // A budget well above the real size is not a ratchet, it is permission. Anything that has
    // shrunk by more than a little should have its number brought down in the same commit, or the
    // room it left is silently available again.
    const slack = Object.entries(SIZE_BUDGET)
      .map(([f, b]) => ({ f, slack: b - lineCount(f) }))
      .filter((x) => x.slack > 40)
    expect(
      slack.map((x) => `${x.f} is ${x.slack} lines under budget`),
      'these shrank — lower their budgets to lock the win in',
    ).toEqual([])
  })
})

// EVERY NEW MODULE IN src/lib IS TESTED.
//
// src/lib is where decisions go to become testable. A module added there with no test defeats the
// entire point of moving it — it is the same untestable logic with a longer import path.
//
// The list below is what was already untested when this rule was written. It is a debt register,
// not permission: names may be REMOVED as tests arrive, never added. A new file in src/lib with no
// test fails this immediately.
const UNTESTED_LEGACY = new Set([
  'access', 'album-backgrounds', 'album-design', 'album-owner-access', 'analytics', 'auth',
  'broadcast', 'cf-analytics', 'constants', 'country-names', 'email', 'engagement', 'exif',
  'heic-worker', 'media-display', 'my-albums', 'polls', 'provision-user', 'rate-limit',
  'rekognition', 'report-server-error', 'require-tier', 'slideshow-motion', 'useIsNarrow', 'utils',
])

describe('a new decision module arrives with its tests', () => {
  const testSource = readdirSync(join(process.cwd(), 'tests'))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => readFileSync(join(process.cwd(), 'tests', f), 'utf8'))
    .join('\n')

  const libs = readdirSync(join(process.cwd(), 'src', 'lib'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => f.replace(/\.ts$/, ''))

  it('has no untested module that is not already on the debt register', () => {
    const isTested = (name: string) =>
      testSource.includes(`@/lib/${name}'`) || testSource.includes(`../src/lib/${name}'`)
    const offenders = libs.filter((l) => !isTested(l) && !UNTESTED_LEGACY.has(l))
    expect(
      offenders,
      'a module in src/lib with no test is untestable logic with a longer import path — which is ' +
        'the thing moving it there was meant to fix. Add a test, or say why it cannot have one by ' +
        'putting it on the register above.',
    ).toEqual([])
  })

  it('shrinks the debt register as modules get tested', () => {
    // A name left on the register after its tests arrive makes the register lie, and a lying
    // register stops being read.
    const isTested = (name: string) =>
      testSource.includes(`@/lib/${name}'`) || testSource.includes(`../src/lib/${name}'`)
    const stale = [...UNTESTED_LEGACY].filter((name) => libs.includes(name) && isTested(name))
    expect(stale, 'these are tested now — take them off the register').toEqual([])
  })

  it('does not list modules that no longer exist', () => {
    const gone = [...UNTESTED_LEGACY].filter((name) => !libs.includes(name))
    expect(gone, 'these were deleted — take them off the register').toEqual([])
  })
})
