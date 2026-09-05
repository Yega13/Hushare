// The application's view of the database, generated FROM the database.
//
// WHY NOT THE SUPABASE CLI. `supabase gen types --db-url` needs a DIRECT postgres connection and we
// go through the pooler; `--project-id` needs a logged-in CLI session, which is a credential this
// project does not have and should not acquire to run a code generator. The CLI is not installed
// and there is no Docker here. `pg` is already a dependency, already holds the pooler string via
// scripts/db-connection.mjs, and scripts/dump-schema.mjs already reads these exact catalogs.
//
// WHY A HAND-ROLLED GENERATOR IS SAFE HERE, as a measurement rather than a hope. Probed against the
// live database on 2026-09-05: 16 tables, 153 columns, NINE distinct Postgres types, zero enums,
// zero domains, zero views, zero generated columns, two identity columns. checkInventory() below
// asserts every one of those categories and REFUSES TO WRITE if the schema grows something the
// emitter cannot express -- because a wrong-but-plausible type permits a bad write, and that is the
// one failure mode with no symptom (AGENTS.md rule 19: the uncertain branch does nothing).
//
//   node scripts/gen-db-types.mjs           write src/types/database.ts
//   node scripts/gen-db-types.mjs --check   exit 1 if it is out of date (CI)
import fs from 'node:fs'
import pg from 'pg'
import { connectionString } from './db-connection.mjs'
import { emit, PG_TO_TS } from './gen-db-types-emit.mjs'

const CHECK = process.argv.includes('--check')
const OUT = 'src/types/database.ts'

const client = new pg.Client({
  connectionString: connectionString('gen-db-types'),
  ssl: { rejectUnauthorized: false },
  // Without this a pooler that accepts TCP and then never answers hangs the deploy until GitHub's
  // six-hour job timeout. Fifteen seconds is far longer than a healthy connect and far shorter than
  // anything a person would sit through.
  connectionTimeoutMillis: 15_000,
})

// "COULD NOT CONNECT" IS NOT "HAS DRIFTED", and the deploy must not confuse them.
//
// deploy.yml turns any non-zero exit from --check into "src/types/database.ts has drifted from the
// live database. Run node scripts/gen-db-types.mjs and commit it." During a pooler blip that
// sentence is false, and it is read by somebody trying to ship a fix — it sends them to regenerate
// a file that is already correct. A review found this by pointing the script at a dead port and
// watching an uncaught ECONNREFUSED become a drift report.
try {
  await client.connect()
} catch (e) {
  console.error('[gen-db-types] COULD NOT CONNECT to the database — this is NOT a drift failure.')
  console.error('  ' + (e instanceof Error ? e.message : String(e)))
  console.error('  src/types/database.ts may be perfectly correct; nothing was compared.')
  process.exit(2)
}
const q = async (sql) => (await client.query(sql)).rows

const columns = await q(`
  select c.table_name, c.column_name, c.ordinal_position,
         c.data_type, c.udt_name, c.is_nullable, c.column_default,
         c.is_identity, c.identity_generation, c.is_generated
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
  order by c.table_name, c.ordinal_position`)

const functions = await q(`
  select p.proname,
         pg_get_function_arguments(p.oid) as args,
         pg_get_function_result(p.oid)    as ret,
         p.proretset
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    and pg_get_function_result(p.oid) <> 'trigger'
  order by p.proname`)

// THE REFUSAL GATE. Each entry corresponds to a code path the emitter DOES NOT HAVE. The day
// somebody adds a citext column or a view, this stops rather than emitting a plausible lie.
const enums = await q(`
  select 1 from pg_type t join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' limit 1`)
const domains = await q(`select 1 from information_schema.domains where domain_schema = 'public' limit 1`)
const views = await q(`select 1 from information_schema.views where table_schema = 'public' limit 1`)

await client.end()

const generated = columns.filter((c) => c.is_generated !== 'NEVER')
const unmapped = [...new Set(columns.map((c) => c.udt_name))].filter((u) => !(u in PG_TO_TS))

// A name Postgres allows but TypeScript cannot use as a bare property.
//
// `create table "my-table" ("my-col" text)` is perfectly legal SQL, and the emitter would write
// `my-col: string | null`, which is a syntax error — verified: TS1131, Property or signature
// expected. It fails LOUD, because the build breaks, so rule 19's outcome holds either way. But it
// breaks AFTER overwriting a correct database.ts, so the next person is debugging a broken
// generated file rather than reading a sentence that names the column. Refusing first is cheaper.
//
// Reserved words are deliberately NOT excluded: `function: string` is a legal property name, and
// that was checked rather than assumed.
const TS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const badNames = [
  ...new Set([
    ...columns.filter((c) => !TS_IDENTIFIER.test(c.table_name)).map((c) => `table "${c.table_name}"`),
    ...columns.filter((c) => !TS_IDENTIFIER.test(c.column_name)).map((c) => `column "${c.table_name}.${c.column_name}"`),
    ...functions.filter((f) => !TS_IDENTIFIER.test(f.proname)).map((f) => `function "${f.proname}"`),
  ]),
]

// Two pg_proc rows sharing a proname emit the same key twice: TS2300 duplicate identifier. Zero
// overloads exist today; the emitter has no way to express one, so it must not pretend to.
const seenFn = new Set()
const overloaded = [...new Set(functions.filter((f) => {
  if (seenFn.has(f.proname)) return true
  seenFn.add(f.proname)
  return false
}).map((f) => f.proname))]

const refusals = []
if (badNames.length) {
  refusals.push('names that are not valid TypeScript identifiers: ' + badNames.join(', '))
}
if (overloaded.length) {
  refusals.push('overloaded functions (one TS key each, so they collide): ' + overloaded.join(', '))
}
if (enums.length) refusals.push('a pg ENUM now exists; the emitter cannot express one')
if (domains.length) refusals.push('a DOMAIN now exists; the emitter cannot express one')
if (views.length) refusals.push('a VIEW now exists; the emitter does not emit Views')
if (generated.length) {
  refusals.push('GENERATED columns appeared: ' + generated.map((c) => `${c.table_name}.${c.column_name}`).join(', '))
}
if (unmapped.length) refusals.push('unmapped Postgres types: ' + unmapped.join(', '))

if (refusals.length) {
  console.error('[gen-db-types] REFUSING to write — the schema grew something this generator cannot type:')
  for (const r of refusals) console.error('  - ' + r)
  console.error('  A guessed type permits a bad write with no symptom. Extend the emitter, then rerun.')
  process.exit(1)
}

const text = emit(columns, functions)

if (CHECK) {
  // LF-normalised, for the reason dump-schema.mjs already learned: the repo stores LF, a Windows
  // checkout has CRLF, and a drift warning that fires when nothing drifted is one people learn to
  // scroll past.
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  const norm = (s) => s.split(String.fromCharCode(13)).join('').trim()
  if (norm(current) !== norm(text)) {
    console.error(`[gen-db-types] ${OUT} is OUT OF DATE with the live database.`)
    console.error('  Run: node scripts/gen-db-types.mjs   and commit the result.')
    console.error('  Every type guarantee in this build is void until you do.')
    process.exit(1)
  }
  console.log('[gen-db-types] ok — ' + OUT + ' matches the live database.')
} else {
  fs.writeFileSync(OUT, text)
  const tables = new Set(columns.map((c) => c.table_name)).size
  const identity = columns.filter((c) => c.is_identity === 'YES').length
  console.log(`[gen-db-types] wrote ${OUT}`)
  console.log(`  ${tables} tables, ${columns.length} columns, ${functions.length} functions, ${identity} identity column(s)`)
}
