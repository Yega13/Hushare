// Minimal ambient types for `pg`.
//
// The package ships no declarations and this repo has no @types/pg. Every other consumer is a .mjs
// script, which TypeScript never sees — tests/schema-unions.test.ts is the first TS file to import
// it, and without this the import is an implicit `any` that trips noImplicitAny.
//
// Deliberately NOT @types/pg: that pulls a transitive @types/node pin and describes a surface far
// wider than anything here uses. This declares the three members that are actually called, so an
// accidental use of anything else is a compile error rather than silently `any`.
declare module 'pg' {
  export interface QueryResult<R = Record<string, unknown>> {
    rows: R[]
    rowCount: number | null
  }

  export class Client {
    constructor(config: {
      connectionString?: string
      ssl?: boolean | { rejectUnauthorized: boolean }
      connectionTimeoutMillis?: number
    })
    connect(): Promise<void>
    query<R = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<R>>
    end(): Promise<void>
  }

  const pg: { Client: typeof Client }
  export default pg
}
