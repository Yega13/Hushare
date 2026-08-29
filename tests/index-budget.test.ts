import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createSubrequestBudget,
  SUBREQUEST_BUDGET,
  BUDGET_RESERVE,
  SUBREQUESTS_PER_PHOTO,
} from '../src/lib/server/index-budget'

// GOING OVER THE SUBREQUEST CEILING DOES NOT SLOW INDEXING DOWN — IT KILLS THE WHOLE TICK.
//
// A Worker invocation may make 1000 subrequests; a photo costs three, so an album running both bib
// and Face Finder is 600. Both indexers were sized for ONE album. The cron loops over every album
// that has indexing on, so two race albums using both features is 1200. The only reason it had not
// fired by 2026-08-29 is that the two live albums used one feature each: 600, under the line by
// luck rather than design. The symptom is not "indexing is slow" — it is a tick that throws
// partway and indexes nothing, every minute, silently, right before an event.
//
// THIS FILE IMPORTS THE REAL BUDGET AND CALLS IT. The first version re-implemented the arithmetic
// in order to check it, and re-implemented it BETTER than the code: the simulation clamped the cap
// to the indexer's batch size and the cron did not. 8/8 green against a cron that charged 281
// photos for a 100-photo batch, blew its whole budget on the first album, and skipped face
// indexing on every tick — with the cron being the only thing that indexes faces at all. A test
// that re-implements its subject tests the re-implementation.
function source(rel: string): string {
  return readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8')
}

// Parsed WITHOUT a regex built from a template string. The first version of this helper used one,
// and the backslashes in it were eaten before the file reached disk — the same escape-mangling
// tests/source-hygiene.test.ts exists for. Plain string work cannot be mangled.
function constant(rel: string, name: string): number {
  const marker = `const ${name} = `
  const at = source(rel).indexOf(marker)
  if (at === -1) throw new Error(`${name} not found in ${rel} — it must stay a named constant`)
  const rest = source(rel).slice(at + marker.length)
  const digits = rest.slice(0, rest.search(/[^0-9_]/))
  if (!digits) throw new Error(`${name} in ${rel} is not a plain number`)
  return Number(digits.replace(/_/g, ''))
}

const CRON = 'app/api/cron/bib-index/route.ts'
const BIB_BATCH = constant('lib/server/bib-index.ts', 'BATCH')
const FACE_BATCH = constant('lib/server/face-sweep.ts', 'BATCH')

/** Replays the cron loop over the REAL budget: N albums that all use both features. */
function simulate(albums: number): { spent: number; caps: number[] } {
  const budget = createSubrequestBudget()
  const caps: number[] = []
  for (let i = 0; i < albums; i++) {
    if (budget.affordable(Math.min(BIB_BATCH, FACE_BATCH)) === 0) break
    for (const batchMax of [BIB_BATCH, FACE_BATCH]) {
      const cap = budget.affordable(batchMax)
      if (cap <= 0) continue
      budget.charge(cap)
      caps.push(cap)
    }
  }
  return { spent: budget.spent(), caps }
}

describe('one cron tick can never exceed the subrequest ceiling', () => {
  it('stays inside the budget for any number of race albums', () => {
    for (const albums of [1, 2, 3, 5, 10, 50]) {
      const { spent } = simulate(albums)
      expect(spent, `${albums} albums would budget ${spent} of ${SUBREQUEST_BUDGET} subrequests`)
        .toBeLessThanOrEqual(SUBREQUEST_BUDGET - BUDGET_RESERVE)
    }
  })

  it('the version WITHOUT the budget guard really would have blown it', () => {
    // A guard on the guard. If this stopped being true, the simulation above would be proving
    // nothing — it would pass against code that never had a problem.
    const unguarded = 2 * (BIB_BATCH + FACE_BATCH) * SUBREQUESTS_PER_PHOTO
    expect(unguarded, 'two albums using both features must exceed the ceiling unguarded')
      .toBeGreaterThan(SUBREQUEST_BUDGET)
  })

  it('gives the single album a FULL batch of each — bib AND faces', () => {
    // The regression this file was rewritten for. One race album with both features on is the
    // event; if the bib batch is charged for more than it runs, the face batch gets nothing and
    // Face Finder is never indexed at all. Both caps must come back at full size.
    const { caps } = simulate(1)
    expect(caps, 'one album must get a full bib batch AND a full face batch').toEqual([BIB_BATCH, FACE_BATCH])
  })

  it('charges only for photos that will actually be indexed', () => {
    // affordable() returns 281 on an empty budget; the indexer clamps anything above BATCH to
    // BATCH. Charging the unclamped number is what starved faces.
    const budget = createSubrequestBudget()
    const cap = budget.affordable(BIB_BATCH)
    expect(cap).toBeLessThanOrEqual(BIB_BATCH)
    budget.charge(cap)
    expect(budget.spent()).toBeLessThanOrEqual(BIB_BATCH * SUBREQUESTS_PER_PHOTO + 10)
  })
})

describe('the cron actually applies the budget it computes', () => {
  const cron = source(CRON)

  it('passes a cap to both indexers, clamped to what each will run', () => {
    expect(/indexAlbumBibsBatch\(album\.id,\s*cap\)/.test(cron), 'bib batch must be capped').toBe(true)
    expect(/indexAlbumFacesBatch\(album\.id,\s*cap\)/.test(cron), 'face batch must be capped').toBe(true)
    // The clamp itself. Without the batch ceiling passed in, affordable() hands back 281 and the
    // budget is charged for photos the indexer will never touch.
    expect(/budget\.affordable\(BIB_BATCH\)/.test(cron), 'the bib cap must be clamped to BIB_BATCH').toBe(true)
    expect(/budget\.affordable\(FACE_BATCH\)/.test(cron), 'the face cap must be clamped to FACE_BATCH').toBe(true)
  })

  it('charges the budget before the call, not after', () => {
    // Charging afterwards leaves a window where a second batch is approved against a budget the
    // first one has already spent — which is the overrun this whole file exists to stop.
    const bibAt = cron.indexOf('indexAlbumBibsBatch(album.id, cap)')
    const chargeAt = cron.lastIndexOf('budget.charge(cap)', bibAt)
    expect(chargeAt, 'the charge must appear before the call').toBeGreaterThan(-1)
    expect(chargeAt).toBeLessThan(bibAt)
  })

  it('rotates which album is swept first', () => {
    // With a shared budget, a fixed order starves whoever is last — permanently, on a busy day.
    // Their runners are not told indexing is behind; they are told they are not in any photos.
    expect(/Math\.floor\(Date\.now\(\) \/ 60_000\) % list\.length/.test(cron), 'start must rotate').toBe(true)
    expect(/\.order\('id'/.test(cron), 'the album list must be ordered for the rotation to mean anything').toBe(true)
  })
})

describe('both indexers honour a cap they are given', () => {
  for (const rel of ['lib/server/bib-index.ts', 'lib/server/face-sweep.ts']) {
    it(`${rel} limits by the cap, not by its own BATCH`, () => {
      const s = source(rel)
      expect(/max: number = BATCH/.test(s), 'must accept a max').toBe(true)
      expect(/const cap = Math\.max\(1, Math\.min\(BATCH, Math\.floor\(max\)\)\)/.test(s), 'must clamp it').toBe(true)
      expect(/\.limit\(cap\)/.test(s), 'the query must use the cap').toBe(true)
      expect(/\.limit\(BATCH\)/.test(s), 'the uncapped limit must be gone').toBe(false)
    })
  }
})
