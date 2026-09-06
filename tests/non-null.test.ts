import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { withNonNull, nullDropReport } from '@/lib/non-null'

// THE BODY OF A TYPE PREDICATE, TESTED -- because the compiler does not.
//
// A `.filter((a): a is T & { x: string } => a.x !== null)` narrows by its signature. Change the body
// to `=> true` and tsc stays green while `new Date(null)` runs at the call site. That mutation
// survived when this logic was inline in two crons, which is why it lives here with these tests:
// the signature is held by tsc at every call site, and the body is held by this file.

type Row = { id: string; expires: string | null; tier: string | null; note: string | null }
const rows: Row[] = [
  { id: 'a', expires: '2026-10-01', tier: 'pro', note: null },
  { id: 'b', expires: null, tier: 'pro', note: 'x' },
  { id: 'c', expires: '2026-10-02', tier: null, note: 'y' },
  { id: 'd', expires: '2026-10-03', tier: 'studio', note: 'z' },
]

describe('withNonNull keeps exactly the rows where every named key is present', () => {
  it('drops a row that is null in ANY named key', () => {
    expect(withNonNull(rows, 'expires', 'tier').map((r) => r.id)).toEqual(['a', 'd'])
  })

  it('only the NAMED keys count -- a null elsewhere is fine', () => {
    // `note` is null on row a and a is kept: the filter is about the columns the query guaranteed,
    // not about every nullable column on the row.
    expect(withNonNull(rows, 'expires').map((r) => r.id)).toEqual(['a', 'c', 'd'])
  })

  it('treats undefined like null', () => {
    const sparse = [{ id: 'u', expires: undefined as unknown as string | null, tier: 'pro', note: null }]
    expect(withNonNull(sparse, 'expires')).toEqual([])
  })

  it('with no keys named, keeps everything', () => {
    expect(withNonNull(rows).length).toBe(4)
  })

  it('NARROWS the type of the named keys and leaves the others alone', () => {
    const out = withNonNull(rows, 'expires', 'tier')
    // These three lines are the compile-time half of the guarantee. If the signature ever stopped
    // narrowing, the first two would not compile; if it over-narrowed, the third would not.
    const e: string = out[0].expires
    const t: string = out[0].tier
    const n: string | null = out[0].note
    expect([e, t, n]).toEqual(['2026-10-01', 'pro', null])
  })

  it('returns rows by identity, not copies', () => {
    // Nothing here needs a copy, and on a 5,000-row list a copy per row would be the only cost.
    const out = withNonNull(rows, 'expires')
    expect(out[0]).toBe(rows[0])
  })

  it('empty in, empty out', () => {
    expect(withNonNull([] as Row[], 'expires')).toEqual([])
  })

  it('a FALSY value that is not null is kept -- an empty string or a zero is data, not absence', () => {
    // `!row[k]` would drop these; so would a special case for ''. Both survived a review's mutation
    // run because every fixture value here was a truthy string.
    const falsy = [{ id: 'z', expires: '', count: 0, flag: false }]
    expect(withNonNull(falsy, 'expires', 'count', 'flag').map((r) => r.id)).toEqual(['z'])
  })
})

describe('nullDropReport -- a skipped row is heard, not swallowed', () => {
  it('is null when every row passed, including an empty scan', () => {
    expect(nullDropReport(3, 3, ['a'])).toBeNull()
    expect(nullDropReport(0, 0, ['a'])).toBeNull()
  })
  it('names the keys, counts the drop in context, and keeps the message stable across counts', () => {
    const one = nullDropReport(5, 4, ['package_expires_at', 'package_tier'])!
    const many = nullDropReport(9, 2, ['package_expires_at', 'package_tier'])!
    expect(one.message).toBe(many.message)
    expect(one.message).toContain('package_expires_at, package_tier')
    expect(one.message).not.toMatch(/\d/)
    expect(one.context).toEqual({ scanned: 5, dropped: 1, keys: ['package_expires_at', 'package_tier'] })
    expect(many.context.dropped).toBe(7)
  })
})

describe('every route that narrows with withNonNull reports what it dropped', () => {
  // Wiring, not behaviour: the crons have no route test. What this holds is that a new call site
  // cannot arrive without the report beside it -- rule 19's "say which way it errs" half.
  // ALL of src, .ts and .tsx, minus the module that defines the helper: a call site in lib or in a
  // server component is as silent as one in a route.
  const root = join(process.cwd(), 'src')
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f) && !f.replace(/\\/g, '/').endsWith('lib/non-null.ts'))
    .map((f) => join(root, f))
    .filter((f) => readFileSync(f, 'utf8').includes('withNonNull('))
  it('finds the call sites it is checking', () => { expect(files.length).toBeGreaterThanOrEqual(2) })
  for (const f of files) {
    it(`${f.slice(root.length)} reports its drops, and the report is what it sends`, () => {
      const src = readFileSync(f, 'utf8')
      expect(src.includes('nullDropReport('), 'narrows without reporting the rows it left out').toBe(true)
      // Not "both names appear somewhere": the report's message must be what reportServerError
      // receives, guarded on the report existing. A file that computed the report and logged
      // something else, or reported when there was NO drop, passed the looser version of this.
      expect(src, 'the drop report is not what gets reported').toMatch(/if \(drop\) reportServerError\('[a-z-]+', drop\.message, \{ context: drop\.context \}\)/)
    })
  }
})
