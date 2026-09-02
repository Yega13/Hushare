import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_STORED_DURATION_SECONDS, sumVideoSeconds } from '@/lib/album-entitlements'

// THE ONE PLACE THE VIDEO CLAMP IS WRITTEN TWICE, HELD TOGETHER.
//
// The album's used video seconds are summed by a Postgres function now, because reading up to 1,000
// duration rows into the Worker truncated on Pro and Max albums and read LOW — the budget quietly
// not binding on the paid ones. The move is right, and it creates the exact situation rule 13 exists
// to prevent: the clamp that makes a poisoned row harmless is now written in SQL *and* in
// TypeScript, and SQL cannot import a TypeScript constant.
//
// Rule 13's escape hatch is what this file is: when a value genuinely cannot be shared, write a test
// that asserts the copies agree AND make it read the real source rather than a copy of it. So this
// reads the migration off disk. If someone raises MAX_STORED_DURATION_SECONDS and leaves the SQL at
// 21600, this fails and names both places.
//
// WHAT IT CANNOT DO, stated plainly rather than implied: vitest does not run Postgres, so nothing
// here proves the function returns the right number. It proves the two numbers agree and that the
// clamp is present in the SQL text. The behaviour was verified against the live database when the
// migration was applied (rule 18), and the module's own tests cover everything around the call.

const RAW = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '20260902_album_video_seconds.sql'),
  'utf8',
)

// COMMENTS ARE NOT CODE, and here that is not a nicety — the header of that migration QUOTES the old
// query it replaced, comment and all:
//
//   --   select duration_seconds from photos where album_id = $1 and media_type = 'video' limit 1000
//
// so `toContain("media_type = 'video'")` was satisfied by the paragraph explaining the fix, and
// deleting the real filter from the function left this file green. That is the third time today a
// file's own documentation disarmed its own check (tests/architecture.test.ts had the same shape,
// twice). Strip the prose, then look.
const SQL = RAW.replace(/^\s*--.*$/gm, '')

/** Just the function body, between `as $$` and `$$`, so the index's own WHERE cannot stand in for it. */
const BODY = (SQL.match(/as \$\$([\s\S]*?)\$\$/) ?? ['', ''])[1]

describe('the SQL sum and the TypeScript one agree about the bounds', () => {
  it('uses the same ceiling as MAX_STORED_DURATION_SECONDS', () => {
    expect(MAX_STORED_DURATION_SECONDS).toBe(21600)
    expect(
      BODY,
      `the migration must clamp at ${MAX_STORED_DURATION_SECONDS}, the same ceiling as ` +
      'MAX_STORED_DURATION_SECONDS in src/lib/album-entitlements.ts',
    ).toContain(`least(coalesce(duration_seconds, 0), ${MAX_STORED_DURATION_SECONDS})`)
  })

  it('clamps every ROW, not the total', () => {
    // The bug this shape exists for: one row of -2000000000 summed with real minutes read as zero
    // through a total-only clamp, and that album's video budget was gone permanently. greatest()
    // must be inside the sum() — `sum(greatest(...))`, never `greatest(sum(...))`.
    expect(BODY).toContain('sum(greatest(0, least(')
    expect(BODY).not.toContain('greatest(0, sum(')
  })

  it('counts video rows of one album, and nothing else', () => {
    // Dropping either filter changes what the budget is measured against: without media_type it
    // sums photos (all NULL, so zero), without album_id it sums the platform.
    // Read off the FUNCTION BODY. The file also carries the filter in the partial index's WHERE and
    // in the header comment quoting the old query, either of which would answer for it.
    expect(BODY).toContain("media_type = 'video'")
    expect(BODY).toContain('album_id = p_album_id')
  })

  it('is not callable with the public anon key', () => {
    // Postgres grants EXECUTE to PUBLIC on a new function by default and PostgREST exposes the
    // public schema — so without the revokes, anyone holding the anon key could ask how much video
    // any album id holds. Only the service role, which the upload authorization runs as, may call it.
    expect(SQL).toContain('revoke all on function public.album_video_seconds(uuid) from public')
    expect(SQL).toContain('revoke all on function public.album_video_seconds(uuid) from anon')
    expect(SQL).toContain('revoke all on function public.album_video_seconds(uuid) from authenticated')
    expect(SQL).toContain('grant execute on function public.album_video_seconds(uuid) to service_role')
  })

  it('can be applied twice without failing the deploy', () => {
    // The runner records what it applied, but a migration that is not idempotent turns any manual
    // re-run into a failed deploy — and a failed migration now fails the whole deploy by design.
    expect(SQL).toContain('create or replace function')
    expect(SQL).toContain('create index if not exists')
  })
})

describe('the TypeScript guard the answer still passes through', () => {
  it('drops a total that is negative or not a number', () => {
    // Whatever comes back from the database goes through this before it is believed.
    expect(sumVideoSeconds([{ duration_seconds: -1 }])).toBe(0)
    expect(sumVideoSeconds([{ duration_seconds: Number.NaN }])).toBe(0)
    expect(sumVideoSeconds([{ duration_seconds: null }])).toBe(0)
    expect(sumVideoSeconds([{ duration_seconds: Number.POSITIVE_INFINITY }])).toBe(0)
  })

  it('passes an ordinary total through untouched', () => {
    // It must NOT apply the per-row ceiling to a total — an album may legitimately hold more
    // seconds than any single clip is allowed to be, and clamping there would under-report usage
    // and let more video through than the album paid for.
    expect(sumVideoSeconds([{ duration_seconds: 595 }])).toBe(595)
    expect(sumVideoSeconds([{ duration_seconds: MAX_STORED_DURATION_SECONDS * 2 }]))
      .toBe(MAX_STORED_DURATION_SECONDS * 2)
  })
})
