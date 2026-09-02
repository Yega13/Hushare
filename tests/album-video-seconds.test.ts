import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { stripSqlComments } from './helpers/source-text'
import { MAX_STORED_DURATION_SECONDS } from '@/lib/album-entitlements'

// THE ONE NUMBER THE VIDEO CLAMP NEEDS IN TWO LANGUAGES, HELD TOGETHER.
//
// The album's used video seconds are summed by a Postgres function, because reading up to 1,000
// duration rows into the Worker truncated on Pro and Max albums and read LOW - the budget quietly
// not binding on the paid ones. That move is right, and it leaves exactly one thing written twice:
// the six-hour ceiling. It is MAX_STORED_DURATION_SECONDS in TypeScript and the literal 21600 in
// SQL, and SQL cannot import a TypeScript constant.
//
// The clamp ITSELF is written once, in the SQL. sumVideoSeconds used to be the TypeScript half and
// was deleted once the RPC replaced its last caller - a dead second implementation of the same sum,
// still being described in three comments as the thing that bounds Stream cost, is how the next
// person fixes a bug in the copy that does not run.
//
// Rule 13's escape hatch is what this file is: when a value genuinely cannot be shared, write a test
// that asserts the copies agree AND make it read the real source rather than a copy of it.
//
// WHAT IT CANNOT DO, stated plainly rather than implied: vitest does not run Postgres, so nothing
// here proves the function returns the right number. It proves the SQL says what it should. The
// behaviour was verified against the live database when the migration was applied (rule 18).

// THE MIGRATION IS FOUND, NOT NAMED. Hardcoding the filename made this guard blindest to the only
// correct way of changing the function. db-migrate.mjs skips a file it has already applied, so
// editing that file changes what this test reads and NOTHING in the database - a green suite
// reporting a fix that never shipped. And a later migration redefining the function (which is how it
// must be changed) would be invisible here forever, so the live clamp could be anything while this
// kept reading the September file and passing.
//
// Last-wins, because that is what Postgres ends up with after the runner applies them in order.
const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const DEFINES = /create\s+or\s+replace\s+function\s+public\.album_video_seconds/i

const migrationFile = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => DEFINES.test(stripSqlComments(readFileSync(join(MIGRATIONS, f), 'utf8'))))
  .pop()

if (!migrationFile) throw new Error('no migration defines public.album_video_seconds')

// Comment-stripped, TRAILING comments included. The whole-line strip this used at first left
// `and true -- and media_type = 'video'` answering the filter assertion, which is the migration
// header bug moved one line to the right (MISTAKES entry 21).
const SQL = stripSqlComments(readFileSync(join(MIGRATIONS, migrationFile), 'utf8'))

/** Just the function body, so the partial index's own WHERE cannot stand in for it. */
const BODY = (SQL.match(/as \$\$([\s\S]*?)\$\$/) ?? ['', ''])[1]

/** Collapsed whitespace, so the assertion below is about the SQL and not about formatting. */
const FLAT = BODY.replace(/\s+/g, ' ').trim()

describe('the SQL sum and the TypeScript one agree about the bounds', () => {
  it('uses the same ceiling as MAX_STORED_DURATION_SECONDS', () => {
    expect(MAX_STORED_DURATION_SECONDS).toBe(21600)
    expect(
      BODY,
      `the migration must clamp at ${MAX_STORED_DURATION_SECONDS}, the same ceiling as ` +
      'MAX_STORED_DURATION_SECONDS in src/lib/album-entitlements.ts',
    ).toContain(`least(coalesce(duration_seconds, 0), ${MAX_STORED_DURATION_SECONDS})`)
  })

  it('is EXACTLY this query, whole', () => {
    // ONE EQUALITY, NOT FIVE toContains. The fragment version passed five different wrong functions,
    // and the worst of them was silent on the HEALTHY path: delete the OUTER coalesce and sum() over
    // zero rows returns NULL, which tests/video-upload-authorization.test.ts already proves means
    // every album's FIRST video upload is unbudgeted AND fires "Video budget NOT enforced" into the
    // admin panel — permanently, for every new album. It also passed a function summing a different
    // table, and one with an extra `and hidden = false` (a hidden video still occupies Stream
    // minutes, so filtering it would under-count the bill).
    //
    // Containment cannot catch an ADDITION. Equality can.
    expect(FLAT).toBe(
      'select coalesce(sum(greatest(0, least(coalesce(duration_seconds, 0), 21600))), 0)::bigint '
      + "from public.photos where album_id = p_album_id and media_type = 'video'",
    )
  })

  it('clamps every ROW, not the total', () => {
    // Kept beside the equality because it names the failure: one row of -2000000000 summed with real
    // minutes read as zero through a total-only clamp, and that album's video budget was gone
    // permanently. greatest() must be INSIDE the sum().
    expect(BODY).toContain('sum(greatest(0, least(')
    expect(BODY).not.toContain('greatest(0, sum(')
  })

  it('counts video rows of one album, and nothing else', () => {
    // Dropping either filter changes what the budget is measured against: without media_type it
    // sums photos (all NULL, so zero), without album_id it sums the platform.
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
    // AND NOTHING GRANTS IT BACK. A `grant execute ... to anon` appended after the revokes passed
    // every assertion above — all three revokes are still present, they just no longer hold. It is
    // caught downstream by scripts/check-db.mjs, but a migration should not have to reach production
    // to find that out.
    expect(SQL).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.album_video_seconds\(uuid\)\s+to\s+(public|anon|authenticated)/i,
    )
  })

  it('can be applied twice without failing the deploy', () => {
    // The runner records what it applied, but a migration that is not idempotent turns any manual
    // re-run into a failed deploy — and a failed migration now fails the whole deploy by design.
    expect(SQL).toContain('create or replace function')
    expect(SQL).toContain('create index if not exists')
  })
})
