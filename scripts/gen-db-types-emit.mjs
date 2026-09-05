// The type emitter, separated from the I/O so tests/db-types.test.ts can run it on fixture rows.
//
// A generator that can only be checked by talking to production is a generator nobody checks. Every
// shape below is easy to get subtly wrong and impossible to notice afterwards: a wrong-but-plausible
// type permits a bad write, and a bad write has no symptom until somebody reads the row.

// EVERY Postgres type this database uses, and nothing else.
//
// Measured against the live database 2026-09-05: exactly these nine appear across all 153 public
// columns. gen-db-types.mjs REFUSES to write when a tenth shows up rather than guessing at it --
// see the refusal gate there. A guessed mapping is the failure mode with no symptom.
export const PG_TO_TS = {
  text: 'string',
  uuid: 'string',
  // PostgREST serialises timestamptz as an ISO-8601 STRING, never a Date. Typing it as Date would
  // compile everywhere and be wrong at every call site.
  timestamptz: 'string',
  bool: 'boolean',
  int2: 'number',
  int4: 'number',
  // int8 -> number is a deliberate lossy choice, stated rather than hidden. PostgREST serialises
  // bigint as a JSON number and JS is exact to 2^53. The only two int8 columns are error_events.id
  // and rate_limit_events.id, both identity counters in the tens of thousands. scripts/check-db.mjs
  // is where a ceiling check belongs if either ever approaches it.
  int8: 'number',
  jsonb: 'Json',
  // _text -> string[] is slightly optimistic, stated rather than hidden. A Postgres text[] may hold
  // NULL ELEMENTS, which PostgREST sends as [null] -- so the honest type is (string | null)[].
  // Verified on the live database: zero rows in photos have a null element in face_ids or
  // bib_numbers, and both arrays are one-dimensional. Tightening it would add a null check to every
  // consumer for a case the data does not contain; the note is here so the day it does, this is
  // the line to change.
  _text: 'string[]',
}

// No backslash anywhere in this file: an escape written through a shell heredoc has been mangled on
// the way to disk three times in this project (AGENTS.md rule 24), and the cheapest way to be immune
// is to never need one.
const NEWLINE = String.fromCharCode(10)

function tsType(col) {
  const base = PG_TO_TS[col.udt_name]
  if (!base) {
    throw new Error(`unmapped udt_name '${col.udt_name}' on ${col.table_name}.${col.column_name}`)
  }
  return col.is_nullable === 'NO' ? base : `${base} | null`
}

// GENERATED ALWAYS AS IDENTITY is not "optional on insert" -- Postgres REJECTS an explicit value
// without OVERRIDING SYSTEM VALUE. The Supabase CLI emits `id?: number` here, which type-checks a
// write the database will refuse with 428C9. Omitting the column entirely is the only shape that
// cannot lie about what is allowed.
const isAlwaysIdentity = (col) => col.is_identity === 'YES' && col.identity_generation === 'ALWAYS'

// ANY identity column is filled by the database, whatever its generation.
//
// This is separate from isAlwaysIdentity because the two answer different questions, and conflating
// them produced a real bug caught by tests/db-types.test.ts on its first run: information_schema
// reports `column_default = NULL` for an identity column (the sequence is not a column default), so
// the plain "NOT NULL and no default" rule marked a BY DEFAULT identity column REQUIRED on insert --
// forcing every caller to supply an id the database was going to fill for them.
//
// No live column is BY DEFAULT today; both are ALWAYS. The rule is written correctly anyway, because
// the day one appears there will be nothing to notice.
const isIdentity = (col) => col.is_identity === 'YES'

function emitTable(name, cols) {
  const out = []
  out.push(`      ${name}: {`)
  out.push('        Row: {')
  for (const c of cols) out.push(`          ${c.column_name}: ${tsType(c)}`)
  out.push('        }')
  out.push('        Insert: {')
  for (const c of cols) {
    if (isAlwaysIdentity(c)) continue
    // Required only when the database has no other way to fill it: NOT NULL and no default.
    // 40 live columns are NOT NULL *with* a default; marking those required would make every
    // insert in the codebase fail to compile, which is loud. Marking a genuinely-required column
    // optional is the quiet direction, and the one that reaches a customer as a 400.
    const required = c.is_nullable === 'NO' && c.column_default === null && !isIdentity(c)
    out.push(`          ${c.column_name}${required ? '' : '?'}: ${tsType(c)}`)
  }
  out.push('        }')
  out.push('        Update: {')
  for (const c of cols) {
    if (isAlwaysIdentity(c)) continue
    out.push(`          ${c.column_name}?: ${tsType(c)}`)
  }
  out.push('        }')
  out.push('        Relationships: []')
  out.push('      }')
  return out
}

// `p_days integer, p_tz text` / `p_limit integer DEFAULT 300` / `p_ids uuid[]`
const SQL_ARG_TO_TS = {
  integer: 'number', bigint: 'number', smallint: 'number', numeric: 'number',
  'double precision': 'number', real: 'number',
  text: 'string', uuid: 'string', boolean: 'boolean', jsonb: 'Json', json: 'Json',
  'character varying': 'string',
  'uuid[]': 'string[]', 'text[]': 'string[]', 'integer[]': 'number[]',
  'timestamp with time zone': 'string', 'timestamp without time zone': 'string',
  date: 'string', interval: 'string', void: 'undefined',
}

function sqlToTs(sqlType, where) {
  const ts = SQL_ARG_TO_TS[sqlType.trim()]
  if (!ts) throw new Error(`unmapped SQL type '${sqlType}' on ${where}`)
  return ts
}

/**
 * Split a function's argument list on top-level commas only.
 *
 * `pg_get_function_arguments` returns things like `p_ids uuid[], p_meta jsonb DEFAULT '{}'::jsonb`,
 * and a naive split on "," breaks any default containing one. Depth tracking is the whole reason
 * this is a function rather than a `.split(',')`.
 */
function splitArgs(raw) {
  const out = []
  let depth = 0
  let cur = ''
  let quoted = false
  for (const ch of raw) {
    if (ch === "'") quoted = !quoted
    if (!quoted && (ch === '(' || ch === '[')) depth++
    if (!quoted && (ch === ')' || ch === ']')) depth--
    if (ch === ',' && depth === 0 && !quoted) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

function emitFunction(fn) {
  const args = splitArgs(fn.args || '').map((raw) => {
    // OUT/INOUT parameters are part of the RESULT, not the arguments a caller passes.
    if (/^(out|inout)\s/i.test(raw)) return null
    const hasDefault = / DEFAULT /i.test(raw)
    const decl = raw.replace(/ DEFAULT [\s\S]*$/i, '').replace(/^in\s+/i, '').trim()
    const sp = decl.indexOf(' ')
    if (sp < 0) throw new Error(`unparseable argument '${raw}' on ${fn.proname}`)
    const argName = decl.slice(0, sp)
    const ts = sqlToTs(decl.slice(sp + 1), `${fn.proname}(${argName})`)
    // EVERY function argument is nullable, and saying otherwise is a factual error about Postgres.
    //
    // There is no NOT NULL on a function parameter -- `f(p_album_id uuid)` accepts NULL, and this
    // codebase relies on that: coalesce_error_event is called with p_album_id = null for every
    // error not tied to an album, and with p_ua = null from the server. The first version of this
    // emitter typed arguments as plain `T`, which produced eight compile errors against correct,
    // shipping call sites. A type that rejects what the database accepts is not stricter, it is
    // wrong (AGENTS.md rule 18: verify against reality, not against names).
    //
    // `Json` already admits null, so adding it there would be noise.
    const nullable = ts === 'Json' ? ts : `${ts} | null`
    return `        ${argName}${hasDefault ? '?' : ''}: ${nullable}`
  }).filter(Boolean)

  // TABLE(a bool, b int) -> a row shape; a set-returning scalar -> an array of it.
  const table = /^TABLE\(([\s\S]*)\)$/.exec(fn.ret)
  let ret
  if (table) {
    const fields = splitArgs(table[1]).map((f) => {
      const sp = f.indexOf(' ')
      return `${f.slice(0, sp)}: ${sqlToTs(f.slice(sp + 1), `${fn.proname} result`)}`
    })
    ret = `{ ${fields.join('; ')} }[]`
  } else if (fn.ret === 'void') {
    ret = 'undefined'
  } else {
    const ts = sqlToTs(fn.ret, `${fn.proname} result`)
    ret = fn.proretset ? `${ts}[]` : ts
  }

  return [
    `      ${fn.proname}: {`,
    args.length
      ? `        Args: {${NEWLINE}${args.join(NEWLINE)}${NEWLINE}        }`
      : '        Args: Record<string, never>',
    `        Returns: ${ret}`,
    '      }',
  ]
}

export function emit(columns, functions) {
  const byTable = new Map()
  for (const c of columns) {
    if (!byTable.has(c.table_name)) byTable.set(c.table_name, [])
    byTable.get(c.table_name).push(c)
  }

  const out = []
  out.push('// GENERATED FROM THE LIVE DATABASE -- do not hand-edit.')
  out.push('//')
  out.push('//   node scripts/gen-db-types.mjs           regenerate')
  out.push('//   node scripts/gen-db-types.mjs --check   fail if this file has drifted')
  out.push('//')
  out.push('// This file is what makes a wrong column name a COMPILE error instead of an empty result')
  out.push('// at an event. Before it existed the Supabase clients were typed SupabaseClient<any>, so')
  out.push('// every .select() string in the product was checked by nobody, and 79 call sites carried')
  out.push('// a .returns<T>() that -- verified against postgrest-js 2.108.2 -- checks array-ness and')
  out.push('// nothing else. A misspelled column returned undefined rather than failing.')
  out.push('')
  out.push('export type Json =')
  out.push('  | string')
  out.push('  | number')
  out.push('  | boolean')
  out.push('  | null')
  out.push('  | { [key: string]: Json | undefined }')
  out.push('  | Json[]')
  out.push('')
  out.push('export type Database = {')
  out.push('  public: {')
  out.push('    Tables: {')
  for (const [name, cols] of [...byTable].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(...emitTable(name, cols))
  }
  out.push('    }')
  out.push('    Views: Record<never, never>')
  out.push('    Functions: {')
  for (const fn of [...functions].sort((a, b) => a.proname.localeCompare(b.proname))) {
    out.push(...emitFunction(fn))
  }
  out.push('    }')
  out.push('    Enums: Record<never, never>')
  out.push('    CompositeTypes: Record<never, never>')
  out.push('  }')
  out.push('}')
  out.push('')
  out.push("/** A table's row shape, for the places a select string cannot be a literal. */")
  out.push("export type Tables<T extends keyof Database['public']['Tables']> =")
  out.push("  Database['public']['Tables'][T]['Row']")
  out.push('')
  return out.join(NEWLINE)
}
