import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { applyRestore, chunkRows, insertStatement, reconcileColumns, restoreOrder, CHUNK } from '../scripts/restore-core.mjs'
import { createTableSql } from '../scripts/restore-rehearse.mjs'

// THE RESTORE PATH, RUN AGAINST A REAL POSTGRES.
//
// A backup nobody has ever restored is a guess. `npm run restore:rehearse` restores a REAL backup
// file into an in-process Postgres and verifies it; this is the same code, the same schema, and a
// synthetic dump -- so it runs in CI where no backup file exists and no customer row is ever
// checked into the repository. The schema comes from tests/fixtures/live-schema.json, taken by
// read-only introspection of the live database (scripts/db-schema-snapshot.mjs).
//
// What must hold, and what each was written for:
//   * a dry run writes NOTHING;
//   * parents are written before children;
//   * a second restore inserts nothing (ON CONFLICT DO NOTHING), so a healthy database is a no-op;
//   * arrays, jsonb, timestamps and nulls survive, because they go through parameters and not
//     through escaping written by hand;
//   * a column or table the schema has dropped since the backup is reported and skipped rather
//     than aborting every table -- the first rehearsal of this path died on `albums.media_hover`.

const SCHEMA = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'live-schema.json'), 'utf8'))

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
        sponsor_logos: [{ id: 's1', url: 'https://x/l.png', name: null }],
        media_radius: 16, hide_branding: false, welcome_message: null,
      }],
    },
    authUsers: [{ id: 'u1', email: 'a@b.c' }],
  }
}

// One Postgres for the file: booting the WASM build takes seconds, recreating two tables takes
// milliseconds, and every test needs an empty pair rather than a fresh engine.
let shared: PGlite
beforeAll(async () => { shared = await PGlite.create() }, 60_000)

async function freshDb() {
  await shared.exec('drop table if exists photos; drop table if exists albums;')
  for (const name of ['albums', 'photos']) await shared.exec(createTableSql(name, SCHEMA.tables[name]))
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
    expect(sql).toBe('insert into "photos" ("id", "url") values ($1, $2), ($3, $4) on conflict do nothing')
    expect(sql).not.toMatch(/update|delete|truncate/i)
  })
  it('chunks so one statement cannot exceed the parameter ceiling, and empty means no statement', () => {
    expect(chunkRows(Array.from({ length: 450 }, (_, i) => i)).map((c) => c.length)).toEqual([200, 200, 50])
    expect(chunkRows([])).toEqual([])
    expect(CHUNK * 27).toBeLessThan(65535)   // the widest table this database has
  })
  it('keeps the columns that still exist, names the ones that are gone, and notes the new ones', () => {
    const r = reconcileColumns(['id', 'media_hover', 'title'], ['id', 'title', 'reveal_at'])
    expect(r.use).toEqual(['id', 'title'])
    expect(r.dropped).toEqual(['media_hover'])
    expect(r.absentFromBackup).toEqual(['reveal_at'])
  })
})

describe('a restore against a real Postgres', () => {
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
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables where table_name = 'users'`)
    expect(rows[0].n).toBe(0)
  })
})
