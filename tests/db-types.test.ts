import { describe, it, expect } from 'vitest'
// The emitter is plain .mjs, shared with the generator script. Importing the REAL one is the point:
// a test that re-implements its subject tests the re-implementation (AGENTS.md rule 17).
import { emit, PG_TO_TS } from '../scripts/gen-db-types-emit.mjs'

// THE FIVE SHAPES THAT ARE EASY TO GET WRONG AND IMPOSSIBLE TO NOTICE.
//
// src/types/database.ts is generated, so nothing in it can be reviewed line by line -- 748 lines
// nobody will read. What CAN be reviewed is the handful of rules that produced it, and each of these
// has a failure mode with no symptom: a column typed nullable when it is not, an identity column
// offered on insert, a NOT NULL column marked optional. The database rejects the write, the caller
// sees a 400, and the types said it was fine.
//
// Fixture rows rather than a live connection, so this runs in the normal suite with no credentials.

const base = {
  table_name: 't', ordinal_position: 1, data_type: 'text', udt_name: 'text',
  is_nullable: 'YES', column_default: null, is_identity: 'NO',
  identity_generation: null, is_generated: 'NEVER',
}
const col = (o: Record<string, unknown>) => ({ ...base, ...o })

const insertBlock = (out: string) => out.split('Insert: {')[1].split('Update: {')[0]
const updateBlock = (out: string) => out.split('Update: {')[1].split('Relationships')[0]
const rowBlock = (out: string) => out.split('Row: {')[1].split('Insert: {')[0]

describe('the emitter gets the insert shape right', () => {
  it('NOT NULL with NO default is REQUIRED on insert', () => {
    const out = emit([col({ column_name: 'slug', is_nullable: 'NO' })], [])
    expect(rowBlock(out)).toContain('slug: string')
    expect(insertBlock(out)).toContain('slug: string')
    expect(insertBlock(out)).not.toContain('slug?:')
  })

  it('NOT NULL WITH a default is OPTIONAL on insert but non-null on read', () => {
    // 40 live columns are in this state. Getting it backwards the loud way makes every insert in
    // the codebase fail to compile; getting it backwards the QUIET way lets a NOT NULL column be
    // omitted, which is a 400 in front of a guest.
    const out = emit([col({ column_name: 'hidden', udt_name: 'bool', is_nullable: 'NO', column_default: 'false' })], [])
    expect(insertBlock(out)).toContain('hidden?: boolean')
    expect(rowBlock(out)).toContain('hidden: boolean')
    expect(rowBlock(out)).not.toContain('hidden: boolean | null')
  })

  it('a nullable column is `| null` on read and optional on insert', () => {
    const out = emit([col({ column_name: 'caption' })], [])
    expect(rowBlock(out)).toContain('caption: string | null')
    expect(insertBlock(out)).toContain('caption?: string | null')
  })
})

describe('GENERATED ALWAYS AS IDENTITY is absent from writes', () => {
  it('appears on Row but on neither Insert nor Update', () => {
    // Postgres REJECTS an explicit value without OVERRIDING SYSTEM VALUE (SQLSTATE 428C9). The
    // Supabase CLI emits `id?: number`, which type-checks a write the database refuses. Two live
    // columns are in this state: error_events.id and rate_limit_events.id.
    const out = emit([col({
      column_name: 'id', udt_name: 'int8', is_nullable: 'NO',
      is_identity: 'YES', identity_generation: 'ALWAYS',
    })], [])
    expect(rowBlock(out)).toContain('id: number')
    expect(insertBlock(out)).not.toContain('id')
    expect(updateBlock(out)).not.toContain('id')
  })

  it('a BY DEFAULT identity is still writable — only ALWAYS is forbidden', () => {
    const out = emit([col({
      column_name: 'id', udt_name: 'int8', is_nullable: 'NO',
      is_identity: 'YES', identity_generation: 'BY DEFAULT',
    })], [])
    expect(insertBlock(out)).toContain('id?: number')
  })
})

describe('the type map', () => {
  it('maps jsonb to Json, which is what makes the sponsor_logos crash a compile error', () => {
    // MISTAKES: sponsor_logos[].url held a NUMBER and startsWith threw MID-DELETION. Under `Json`
    // that line cannot compile, because number has no startsWith.
    expect(PG_TO_TS.jsonb).toBe('Json')
    const out = emit([col({ column_name: 'sponsor_logos', udt_name: 'jsonb', is_nullable: 'NO' })], [])
    expect(rowBlock(out)).toContain('sponsor_logos: Json')
  })

  it('maps timestamptz to string, not Date — PostgREST sends ISO text', () => {
    expect(PG_TO_TS.timestamptz).toBe('string')
  })

  it('maps a text array to string[]', () => {
    const out = emit([col({ column_name: 'bib_numbers', udt_name: '_text' })], [])
    expect(rowBlock(out)).toContain('bib_numbers: string[] | null')
  })

  it('REFUSES an unmapped type instead of guessing one', () => {
    // The whole safety argument for a hand-rolled generator rests on this branch.
    expect(() => emit([col({ column_name: 'x', udt_name: 'citext' })], [])).toThrow(/unmapped/)
  })
})

describe('functions, because an empty Functions map breaks every .rpc()', () => {
  it('emits args and a TABLE return shape', () => {
    // With `Functions: Record<never, never>`, `.rpc('rate_limit_hit')` fails with "not assignable
    // to parameter of type 'never'". Fifteen live .rpc() call sites depend on this being right.
    const out = emit([], [{
      proname: 'rate_limit_hit',
      args: 'p_key text, p_window_seconds integer, p_max integer',
      ret: 'TABLE(allowed boolean, retry_after integer)',
      proretset: true,
    }])
    // `| null` because Postgres has no NOT NULL on a function parameter — every argument accepts
    // NULL, and coalesce_error_event is called with p_album_id = null for every error not tied to
    // an album. Typing these non-nullable produced eight compile errors against correct code.
    expect(out).toContain('p_key: string | null')
    expect(out).toContain('Returns: { allowed: boolean; retry_after: number }[]')
  })

  it('makes a DEFAULTed argument optional', () => {
    const out = emit([], [{ proname: 'f', args: 'p_limit integer DEFAULT 300', ret: 'boolean', proretset: false }])
    expect(out).toContain('p_limit?: number | null')
  })

  it('splits arguments on TOP-LEVEL commas only', () => {
    // THE DEFAULT MUST CONTAIN A COMMA, or this test proves nothing.
    //
    // The first version used `DEFAULT '{}'::jsonb`, which has no comma inside it — so splitting on
    // every comma produced exactly the same three arguments and the mutation survived. A fixture
    // has to contain the thing the code is defending against; `'{"a":1,"b":2}'` does.
    const out = emit([], [{
      proname: 'f', args: `p_ids uuid[], p_meta jsonb DEFAULT '{"a":1,"b":2}'::jsonb, p_n integer`,
      ret: 'void', proretset: false,
    }])
    expect(out).toContain('p_ids: string[] | null')
    // Json already admits null, so it is NOT given a redundant `| null`.
    expect(out).toContain('p_meta?: Json')
    expect(out).not.toContain('p_meta?: Json | null')
    expect(out).toContain('p_n: number | null')
    expect(out).toContain('Returns: undefined')
  })

  it('splits a TABLE return on top-level commas too', () => {
    // Same hazard on the result side, and it produces a silently wrong row shape rather than a
    // throw — which is worse, because it compiles.
    const out = emit([], [{
      proname: 'f', args: '', ret: 'TABLE(ok boolean, meta jsonb, n integer)', proretset: true,
    }])
    expect(out).toContain('Returns: { ok: boolean; meta: Json; n: number }[]')
  })

  it('a function with no arguments gets a closed Args type', () => {
    const out = emit([], [{ proname: 'f', args: '', ret: 'integer', proretset: false }])
    expect(out).toContain('Args: Record<string, never>')
  })

  it('excludes OUT and INOUT parameters — they are the RESULT, not arguments', () => {
    // A caller does not pass an OUT parameter. Emitting one puts a required argument in the type
    // that every real call site is missing.
    const out = emit([], [{
      proname: 'f', args: 'p_in text, OUT p_out integer, INOUT p_both boolean',
      ret: 'integer', proretset: false,
    }])
    expect(out).toContain('p_in: string | null')
    expect(out).not.toContain('p_out')
    expect(out).not.toContain('p_both')
  })

  it('strips an explicit IN prefix rather than reading it as the name', () => {
    // `IN p_key text` would otherwise emit an argument literally called "IN".
    const out = emit([], [{ proname: 'f', args: 'IN p_key text', ret: 'void', proretset: false }])
    expect(out).toContain('p_key: string | null')
    expect(out).not.toMatch(/\bIN:/)
  })

  it('a set-returning SCALAR function returns an array', () => {
    // proretset with a scalar return is `setof text`, not a TABLE — a different branch from the
    // TABLE case above, and it had no fixture.
    const scalarSet = emit([], [{ proname: 'f', args: '', ret: 'text', proretset: true }])
    expect(scalarSet).toContain('Returns: string[]')
    const scalarOne = emit([], [{ proname: 'f', args: '', ret: 'text', proretset: false }])
    expect(scalarOne).toContain('Returns: string')
    expect(scalarOne).not.toContain('Returns: string[]')
  })

  it('REFUSES an unmapped argument type instead of guessing', () => {
    expect(() => emit([], [{ proname: 'f', args: 'p_x citext', ret: 'void', proretset: false }]))
      .toThrow(/unmapped SQL type/)
  })
})

describe('the generated file has a stable, complete shape', () => {
  // These looked too obvious to test, and a mutation run proved that "obvious" is not "checked":
  // deleting the sorts, `Relationships: []` and the `Views` line all survived the whole suite.

  it('sorts tables and functions, so a regenerate is a clean diff', () => {
    // Without a sort the emitted order follows whatever the catalog returns, and an unrelated
    // schema change reshuffles the file — turning every regenerate into an unreviewable diff and
    // making the CI drift check fire on nothing.
    const out = emit(
      [{ ...base, table_name: 'zebra', column_name: 'a' }, { ...base, table_name: 'alpha', column_name: 'a' }],
      [{ proname: 'zed', args: '', ret: 'void', proretset: false },
        { proname: 'abc', args: '', ret: 'void', proretset: false }],
    )
    expect(out.indexOf('alpha: {')).toBeLessThan(out.indexOf('zebra: {'))
    expect(out.indexOf('abc: {')).toBeLessThan(out.indexOf('zed: {'))
  })

  it('emits the structural keys postgrest-js expects', () => {
    // A missing Relationships or Views key does not fail loudly — it changes what the client's
    // types resolve to, quietly.
    const out = emit([{ ...base, table_name: 't', column_name: 'a' }], [])
    expect(out).toContain('Relationships: []')
    expect(out).toContain('Views: Record<never, never>')
    expect(out).toContain('Enums: Record<never, never>')
    expect(out).toContain('CompositeTypes: Record<never, never>')
    expect(out).toContain('export type Json =')
    expect(out).toContain("export type Tables<T extends keyof Database['public']['Tables']> =")
  })
})
