import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { applyRestore, chunkRows, columnsOf, heterogeneousCount, insertStatement, quoteIdent, reconcileColumns, restoreOrder, CHUNK } from '../scripts/restore-core.mjs'
import { buildRehearsalDb } from '../scripts/rehearsal-db.mjs'

// THE RESTORE PATH, RUN AGAINST A REAL POSTGRES.
//
// A backup nobody has ever restored is a guess. `npm run restore:rehearse` restores a REAL backup
// file into an in-process Postgres and verifies it; this is the same code, the same schema, and a
// synthetic dump -- so it runs in CI where no backup file exists and no customer row is ever
// checked into the repository. The schema is `schema.sql` -- the file a recovery actually runs,
// generated from the live database and guarded against drift by the deploy -- so this database has
// the real foreign keys, checks, unique and NOT NULL constraints. That matters: the first version
// built tables from a snapshot of names and types, and passed while the real restore was broken by
// a foreign-key cycle its target could not express.
//
// What must hold, and what each was written for:
//   * a dry run writes NOTHING;
//   * parents are written before children;
//   * a second restore inserts nothing (ON CONFLICT DO NOTHING), so a healthy database is a no-op;
//   * arrays, jsonb, timestamps and nulls survive, because they go through parameters and not
//     through escaping written by hand;
//   * a column or table the schema has dropped since the backup is reported and skipped rather
//     than aborting every table -- the first rehearsal of this path died on `albums.media_hover`.

const ALBUM_ID = '11111111-1111-1111-1111-111111111111'
const PHOTO_ID = '22222222-2222-2222-2222-222222222222'

/** A dump shaped exactly like backup-db.mjs writes one, with the awkward types on purpose. */
function dump() {
  return {
    meta: { takenAt: '2026-08-26T11:04:49.898Z', skipped: ['rate_limit_events'] },
    tables: {
      photos: [{
        id: PHOTO_ID, album_id: ALBUM_ID, storage_path: 'a/b.jpg', url: 'https://x/b.jpg',
        media_type: 'image', created_at: '2026-08-26T10:00:00.000Z',
        bib_numbers: ['945', '0945'], face_ids: [], caption: null, width: 4032, height: 3024,
        hidden: false,
      }],
      albums: [{
        id: ALBUM_ID, slug: 'race', title: 'Race', created_at: '2026-08-01T09:00:00.000Z',
        // owner_token is NOT NULL with no default: a dump that omitted it would be refused, which
        // is the schema doing its job and the reason this database is built with its constraints.
        owner_token: 'tok-1',
        sponsor_logos: [{ id: 's1', url: 'https://x/l.png', name: null }],
        media_radius: 16, hide_branding: false, welcome_message: null,
      }],
    },
    authUsers: [{ id: 'u1', email: 'a@b.c' }],
  }
}

// One Postgres for the file: booting the WASM build and applying the whole schema takes seconds,
// emptying the tables takes milliseconds. Every test needs an empty database, not a fresh engine.
let shared: PGlite
beforeAll(async () => { shared = (await buildRehearsalDb()).db }, 120_000)

async function freshDb() {
  // truncate, not delete-and-recreate: the constraints are the point of this database.
  await shared.exec('truncate table photos, albums restart identity cascade')
  return shared
}
const count = async (db: PGlite, t: string) =>
  Number((await db.query<{ count: number }>(`select count(*)::int as count from "${t}"`)).rows[0].count)

describe('the pure decisions', () => {
  it('writes parents before children, and anything unnamed after them in its own order', () => {
    expect(restoreOrder(['photos', 'error_events', 'profiles', 'albums']))
      .toEqual(['albums', 'photos', 'error_events', 'profiles'])
  })
  it('never invents a table the dump does not carry', () => {
    expect(restoreOrder(['photos'])).toEqual(['photos'])
  })
  it('builds a parameterised insert that cannot overwrite a live row', () => {
    const sql = insertStatement('photos', ['id', 'url'], 2)
    expect(sql).toBe('insert into "public"."photos" ("id", "url") values ($1, $2), ($3, $4) on conflict do nothing')
    expect(sql).not.toMatch(/update|delete|truncate/i)
  })
  it('chunks so one statement cannot exceed the parameter ceiling, and empty means no statement', () => {
    expect(chunkRows(Array.from({ length: 450 }, (_, i) => i)).map((c) => c.length)).toEqual([200, 200, 50])
    expect(chunkRows([])).toEqual([])
  })
  it('quotes an identifier so a name carrying a double quote cannot end the statement', () => {
    expect(quoteIdent('id","x") values (1); drop table photos; --')).toBe('id"",""x"") values (1); drop table photos; --')
    expect(insertStatement('photos', ['id'], 1)).toContain('"public"."photos"')
  })
  it('takes the columns of EVERY row, not row zero, and counts the rows that differ', () => {
    const rows = [{ a: 1 }, { a: 2, b: 3 }]
    expect(columnsOf(rows)).toEqual(['a', 'b'])
    expect(heterogeneousCount(rows, ['a', 'b'])).toBe(1)
    expect(heterogeneousCount([{ a: 1 }, { a: 2 }], ['a'])).toBe(0)
  })
  it('keeps the columns that still exist, names the ones that are gone, and notes the new ones', () => {
    const r = reconcileColumns(['id', 'media_hover', 'title'], ['id', 'title', 'reveal_at'])
    expect(r.use).toEqual(['id', 'title'])
    expect(r.dropped).toEqual(['media_hover'])
    expect(r.absentFromBackup).toEqual(['reveal_at'])
  })
})

describe('a restore against a real Postgres', () => {
  it('one chunk can never exceed the parameter ceiling, for the widest table this schema HAS', async () => {
    // Read, not remembered: the comment this replaces said 27 columns and the widest is 53.
    const { rows: [{ widest }] } = await shared.query<{ widest: number }>(
      `select max(n)::int as widest from (select count(*) n from information_schema.columns where table_schema='public' group by table_name) t`)
    expect(widest).toBeGreaterThan(40)
    expect(CHUNK * Number(widest)).toBeLessThan(65535)
  })

  it('a dry run writes NOTHING, and still reports what is missing', async () => {
    const db = await freshDb()
    const res = await applyRestore(db, dump(), { apply: false })
    expect(res.totalWould).toBe(2)
    expect(await count(db, 'albums')).toBe(0)
    expect(await count(db, 'photos')).toBe(0)
  })

  it('writes every row, parents first, and the values survive exactly', async () => {
    const db = await freshDb()
    const res = await applyRestore(db, dump(), { apply: true })
    expect(res.totalWritten).toBe(2)
    expect(res.tables.map((t: { table: string }) => t.table)).toEqual(['albums', 'photos'])

    const { rows: [photo] } = await db.query<Record<string, unknown>>('select * from photos where id = $1', [PHOTO_ID])
    // The types that hand-written escaping gets wrong.
    expect(photo.bib_numbers).toEqual(['945', '0945'])
    expect(photo.face_ids).toEqual([])
    expect(photo.caption).toBeNull()
    expect(photo.hidden).toBe(false)
    expect(photo.width).toBe(4032)
    expect(new Date(photo.created_at as string).toISOString()).toBe('2026-08-26T10:00:00.000Z')
    const { rows: [album] } = await db.query<Record<string, unknown>>('select * from albums where id = $1', [ALBUM_ID])
    expect(album.sponsor_logos).toEqual([{ id: 's1', url: 'https://x/l.png', name: null }])
  })

  it('restoring the same dump twice inserts nothing the second time', async () => {
    const db = await freshDb()
    await applyRestore(db, dump(), { apply: true })
    const again = await applyRestore(db, dump(), { apply: true })
    expect(again.totalWritten).toBe(0)
    expect(await count(db, 'photos')).toBe(1)
  })

  it('a row that still exists is LEFT ALONE: an older dump never overwrites newer data', async () => {
    const db = await freshDb()
    await applyRestore(db, dump(), { apply: true })
    await db.query('update albums set title = $1 where id = $2', ['Renamed since the backup', ALBUM_ID])
    await applyRestore(db, dump(), { apply: true })
    const { rows: [album] } = await db.query<{ title: string }>('select title from albums where id = $1', [ALBUM_ID])
    expect(album.title).toBe('Renamed since the backup')
  })

  it('restores only what is MISSING, alongside rows that are already there', async () => {
    const db = await freshDb()
    const d = dump()
    d.tables.photos.push({ ...d.tables.photos[0], id: '33333333-3333-3333-3333-333333333333', storage_path: 'a/c.jpg' })
    await applyRestore(db, { ...d, tables: { albums: d.tables.albums, photos: [d.tables.photos[0]] } }, { apply: true })
    const res = await applyRestore(db, d, { apply: true })
    expect(res.totalWritten).toBe(1)
    expect(await count(db, 'photos')).toBe(2)
  })

  it('a column the schema has DROPPED is named and skipped, and the rest of the row still lands', async () => {
    // The first rehearsal of this path died here: the 2026-08-26 backup carries albums.media_hover,
    // a column since dropped, and nothing at all was restored.
    const db = await freshDb()
    const d = dump()
    ;(d.tables.albums[0] as unknown as Record<string, unknown>).media_hover = 'none'
    const res = await applyRestore(db, d, { apply: true })
    const albums = res.tables.find((t: { table: string }) => t.table === 'albums')!
    expect(albums.dropped).toEqual(['media_hover'])
    expect(albums.written).toBe(1)
    const { rows: [album] } = await db.query<{ title: string }>('select title from albums where id = $1', [ALBUM_ID])
    expect(album.title).toBe('Race')
  })

  it('a TABLE the schema has dropped is reported and skipped, and the tables after it still restore', async () => {
    const db = await freshDb()
    const d = dump() as unknown as { tables: Record<string, Record<string, unknown>[]> }
    d.tables.studio_credits = [{ id: 'x', balance: 1 }]
    const res = await applyRestore(db, d, { apply: true })
    expect(res.skipped).toEqual([{ table: 'studio_credits', reason: 'no such table in the target database', rows: 1 }])
    expect(res.totalWritten).toBe(2)
    expect(await count(db, 'photos')).toBe(1)
  })

  it('a table whose columns are ALL gone is reported and skipped, not inserted with no columns', async () => {
    const db = await freshDb()
    const d = dump() as unknown as { tables: Record<string, Record<string, unknown>[]> }
    // Every column renamed: the table still exists, but nothing in the backup fits it.
    d.tables.albums = [{ ancient_id: 'x', ancient_title: 'y' }]
    const res = await applyRestore(db, d, { apply: true })
    expect(res.skipped).toEqual([{ table: 'albums', reason: 'no column of the backup still exists', rows: 1 }])
    expect(await count(db, 'albums')).toBe(0)
    // ...and the tables after it still restore.
    expect(await count(db, 'photos')).toBe(1)
  })

  it('the constraint deferral dies with the transaction: the SESSION is left as it was found', async () => {
    // SET LOCAL, not SET. A session-wide replica role would outlive the restore and silently
    // disable every foreign key and trigger for whatever the operator did next in that session.
    const db = await freshDb()
    await applyRestore(db, dump(), { apply: true })
    const { rows } = await db.query<{ session_replication_role: string }>('show session_replication_role')
    expect(rows[0].session_replication_role).toBe('origin')
  })

  it('the dry run COUNTS what is missing, and is not fooled by two equal totals', async () => {
    // The number a human reads before deciding a restore is unnecessary. Subtracting the two
    // cardinalities reported 0 here, for a database whose every row is the wrong one.
    const db = await freshDb()
    const live = dump()
    live.tables.albums[0].id = '99999999-9999-9999-9999-999999999999'
    live.tables.albums[0].slug = 'other'
    live.tables.photos = []
    await applyRestore(db, live, { apply: true })
    expect(await count(db, 'albums')).toBe(1)

    const res = await applyRestore(db, { ...dump(), tables: { albums: dump().tables.albums } }, { apply: false })
    const albums = res.tables.find((t: { table: string }) => t.table === 'albums')!
    expect(albums.live).toBe(1)
    expect(albums.backup).toBe(1)
    expect(albums.missing, 'one live album, one different album in the backup: one is missing').toBe(1)
    expect(albums.exact).toBe(true)
  })

  it("a dump whose rows carry DIFFERENT keys restores every field, not row zero's", async () => {
    // Safe only by coincidence of the producer: backup-db.mjs writes select *, so all rows carry
    // all keys. A hand-edited or merged dump does not, and row zero used to decide for all of them.
    const db = await freshDb()
    const d = dump()
    const [first] = d.tables.photos
    delete (first as Record<string, unknown>).caption
    d.tables.photos.push({ ...first, id: '44444444-4444-4444-4444-444444444444', storage_path: 'a/d.jpg', caption: 'a caption' } as unknown as typeof first)
    const res = await applyRestore(db, d, { apply: true })
    const photos = res.tables.find((t: { table: string }) => t.table === 'photos')!
    expect(photos.uneven, 'the rows that differ are counted and reported').toBe(1)
    const { rows: [back] } = await db.query<{ caption: string | null }>(
      'select caption from photos where id = $1', ['44444444-4444-4444-4444-444444444444'])
    expect(back.caption).toBe('a caption')
  })

  it('a failure part way through leaves NOTHING behind: all or nothing', async () => {
    // albums are written first and succeed; the photo violates NOT NULL and the whole transaction
    // goes. A half-restored database is one nobody can reason about at the worst possible moment.
    const db = await freshDb()
    const d = dump()
    ;(d.tables.photos[0] as unknown as Record<string, unknown>).album_id = null
    await expect(applyRestore(db, d, { apply: true })).rejects.toThrow()
    expect(await count(db, 'albums'), 'the albums that DID insert are rolled back').toBe(0)
    expect(await count(db, 'photos')).toBe(0)
    // ...and the connection is usable afterwards, not stuck in a failed transaction.
    expect(await count(db, 'albums')).toBe(0)
  })

  it('a connection that dies mid-restore rolls back, rather than committing what got through', async () => {
    // A statement error cannot tell rollback from commit -- Postgres treats COMMIT on an aborted
    // transaction as a rollback, so both look right. The case that separates them is a failure
    // that never reaches the server: the albums are in, the photo insert never goes out, and
    // committing there would leave half a database behind.
    const db = await freshDb()
    let died = false
    const flaky = {
      query: (sql: string, params?: unknown[]) => {
        if (!died && sql.startsWith('insert') && sql.includes('"public"."photos"')) {
          died = true
          return Promise.reject(new Error('connection terminated unexpectedly'))
        }
        return db.query(sql, params)
      },
    }
    await expect(applyRestore(flaky, dump(), { apply: true })).rejects.toThrow('connection terminated')
    expect(died).toBe(true)
    expect(await count(db, 'albums'), 'the albums that DID insert are rolled back').toBe(0)
  })

  it('one table can be restored alone', async () => {
    const db = await freshDb()
    const res = await applyRestore(db, dump(), { apply: true, onlyTable: 'albums' })
    expect(res.totalWritten).toBe(1)
    expect(await count(db, 'photos')).toBe(0)
  })

  it('auth.users rows travel in the backup and are NEVER inserted', async () => {
    const db = await freshDb()
    const res = await applyRestore(db, dump(), { apply: true })
    expect(res.authUsersInBackup).toBe(1)
    // The table EXISTS in the target (Supabase owns it, and three tables have foreign keys into
    // it); the property is that the restore writes not one row of it.
    const { rows } = await db.query<{ n: number }>('select count(*)::int as n from auth.users')
    expect(rows[0].n).toBe(0)
  })
})
