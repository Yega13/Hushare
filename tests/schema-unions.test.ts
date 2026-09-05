import { describe, it, expect } from 'vitest'
import { PACKAGE_TIERS, MEDIA_TYPES, STORAGE_BACKENDS, NARROWED_ON_PURPOSE } from '@/lib/db-unions'

// THE TWO COPIES OF AN ENUM THAT IS NOT AN ENUM, HELD TOGETHER.
//
// Thirteen columns are `text` with a `CHECK (col = ANY (ARRAY[...]))`. A generated Database type can
// only call those `string`, so each one is written twice — once in a migration, once as a TypeScript
// union — and rule 13 says two copies of a fact disagree eventually. These already have:
// photos.storage_backend's CHECK permits 'supabase' and StorageBackend never did.
//
// This reads the REAL constraint definitions out of the live database. It is the remedy rule 13
// prescribes for a fact that cannot be imported: a test that reads the actual source, not a third
// copy of it.
//
// IT SKIPS WHEN THERE IS NO DATABASE, AND SAYS SO. A guard that goes quiet when it cannot run is
// the failure scripts/run-tests.mjs exists to prevent — a silent skip reads exactly like a pass.

type CheckMap = Map<string, string[]>

async function readChecks(): Promise<CheckMap | null> {
  try {
    // Typed by the ambient declaration in pg.d.ts — the package ships none.
    const { default: pg } = await import('pg')
    const { connectionString } = await import('../scripts/db-connection.mjs') as {
      connectionString: (label: string) => string
    }
    const client = new pg.Client({
      connectionString: connectionString('schema-unions test'),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
    })
    await client.connect()
    const { rows } = await client.query<{ table_name: string; def: string }>(`
      select rel.relname as table_name, pg_get_constraintdef(con.oid) as def
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      where ns.nspname = 'public' and con.contype = 'c'`)
    await client.end()

    const out: CheckMap = new Map()
    for (const r of rows) {
      // Postgres renders these two ways depending on whether the column needed a ::text cast.
      const m = /\(\((\w+)\)::text = ANY \(\(ARRAY\[(.+?)\]\)::text\[\]\)\)/.exec(r.def)
        ?? /\((\w+) = ANY \(ARRAY\[(.+?)\]\)\)/.exec(r.def)
      if (!m) continue
      const values = m[2].split(',').map((s) => s.trim().replace(/::text$/, '').replace(/^'|'$/g, ''))
      out.set(`${r.table_name}.${m[1]}`, values)
    }
    return out
  } catch {
    return null
  }
}

const checks = await readChecks()

// The union this file asserts, against the column whose CHECK backs it.
const MIRRORED: Array<{ column: string; ts: readonly string[] }> = [
  { column: 'albums.package_tier', ts: PACKAGE_TIERS },
  { column: 'photos.media_type', ts: MEDIA_TYPES },
  { column: 'photos.storage_backend', ts: STORAGE_BACKENDS },
]

describe('the TypeScript unions agree with the database CHECK constraints', () => {
  it('could reach the database at all', () => {
    if (!checks) {
      // Not a silent skip. The suite stays green without credentials, but the reason is printed, so
      // "this guard did not run" never looks like "this guard passed".
      console.warn(
        '[schema-unions] SKIPPED — no database reachable. The unions in lib/db-unions.ts were NOT '
        + 'checked against the live CHECK constraints on this run.',
      )
      return
    }
    // The scan's own reach, asserted: a query that silently matched nothing would report all-clear
    // from a blind spot, which is how tests/architecture.test.ts's walk failed twice.
    expect(checks.size, 'parsed no enum-shaped CHECK constraints — the rendering changed').toBeGreaterThanOrEqual(10)
  })

  for (const { column, ts } of MIRRORED) {
    it(`${column}: TypeScript declares nothing the database forbids`, () => {
      if (!checks) return
      const allowed = checks.get(column)
      expect(allowed, `${column} has no enum-shaped CHECK any more — the union is now unbacked`).toBeDefined()
      // A value TypeScript permits that the database rejects is the dangerous direction: the code
      // writes it, PostgREST answers 400, and nothing said the union was wrong.
      const forbidden = ts.filter((v) => !allowed!.includes(v))
      expect(forbidden, `${column}: TypeScript allows ${forbidden.join(', ')} but the CHECK does not`).toEqual([])
    })

    it(`${column}: any value the database allows but TypeScript does not is DELIBERATE`, () => {
      if (!checks) return
      const allowed = checks.get(column)!
      const missing = allowed.filter((v) => !ts.includes(v))
      const declared = NARROWED_ON_PURPOSE[column]?.missing ?? []
      // This direction is not automatically a bug — a narrower union can be a deliberate choice —
      // but it must be a RECORDED one. Otherwise the next divergence hides behind a known one.
      expect(
        missing,
        `${column}: the CHECK permits ${missing.join(', ')} which TypeScript does not. If that is `
        + 'deliberate, add it to NARROWED_ON_PURPOSE in lib/db-unions.ts with the reason.',
      ).toEqual([...declared])
    })
  }

  it('every recorded narrowing is still real', () => {
    if (!checks) return
    // The other half: a narrowing whose reason has expired should be deleted, not left to excuse a
    // future mismatch on the same column.
    for (const [column, { missing }] of Object.entries(NARROWED_ON_PURPOSE)) {
      const allowed = checks.get(column)
      expect(allowed, `${column} is recorded as narrowed but has no CHECK`).toBeDefined()
      for (const v of missing) {
        expect(allowed!, `${column}: '${v}' is recorded as narrowed away but the CHECK no longer permits it`)
          .toContain(v)
      }
    }
  })
})
