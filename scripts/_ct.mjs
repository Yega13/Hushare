import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { connectionString } from './db-connection.mjs'
const c = new pg.Client({ connectionString: connectionString('ct'), ssl: { rejectUnauthorized: false } })
await c.connect()
const u = (await c.query(`select id from auth.users where email='yeganyansuren13@gmail.com'`)).rows[0]
const albums = (await c.query(`select id, slug, title from albums where user_id=$1 and retired_at is null limit 3`,[u.id])).rows
console.log('  your albums available to group:', albums.length)
const id = randomUUID(), slug = 'zz-test-collection'
await c.query(`delete from collections where slug=$1`, [slug])
await c.query(`insert into collections (id,user_id,name,slug,description) values ($1,$2,$3,$4,$5)`,
  [id, u.id, 'ZZ Test Collection', slug, 'temporary — verifying the feature works'])
let n = 0
for (const a of albums) { await c.query(`insert into collection_albums (collection_id,album_id,sort_order) values ($1,$2,$3)`,[id,a.id,n]); n++ }
console.log(`  created collection "${slug}" with ${n} album(s)`)
console.log('  albums:', albums.map(a=>a.title).join(' | '))
await c.end()
