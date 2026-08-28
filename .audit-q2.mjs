import pg from 'pg'
import { connectionString } from './scripts/db-connection.mjs'
const c = new pg.Client({ connectionString: connectionString('audit'), ssl: { rejectUnauthorized: false } })
await c.connect()
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log('\n### ' + label); console.table(r.rows) }
  catch (e) { console.log('\n### ' + label + ' -> ERROR: ' + e.message) }
}
await q('oldest albums / first possible deletion', `
  select min(created_at) oldest_created, min(last_activity_at) oldest_activity,
         min(last_activity_at)+interval '365 days' first_retire_eligible
  from albums where retired_at is null`)
await q('grandfather buckets (free-tier promise)', `
  select case when user_id is null then 'guest' else 'registered' end owner,
    case when created_at < timestamptz '2026-08-02' then '1: <2026-08-02'
         when created_at < timestamptz '2026-08-25' then '2: 08-02..08-25'
         else '3: >=2026-08-25' end bucket,
    count(*) albums, max(pc.n) max_photos, sum(pc.n) photos
  from albums a left join lateral (select count(*) n from photos p where p.album_id=a.id) pc on true
  group by 1,2 order by 1,2`)
await q('albums at/over 250 items', `
  select a.id, a.slug, a.user_id is null as guest, a.created_at, a.media_cap_override, pc.n photos
  from albums a join lateral (select count(*) n from photos p where p.album_id=a.id) pc on true
  where pc.n >= 200 order by pc.n desc limit 20`)
await q('photos by backend', `
  select storage_backend, count(*) , count(*) filter (where thumb_url is null) no_thumb,
    count(*) filter (where poster_url is null) no_poster
  from photos group by 1`)
await q('pending_stream_uploads', `
  select count(*) total, count(*) filter (where consumed_at is null) unconsumed,
         min(created_at) oldest from pending_stream_uploads`)
await q('albums with >1000 photos (pagination risk)', `
  select count(*) from (select album_id from photos group by 1 having count(*)>1000) x`)
await q('photos rows whose album is missing (orphan rows)', `
  select count(*) from photos p left join albums a on a.id=p.album_id where a.id is null`)
await q('duplicate storage_path across albums', `
  select count(*) from (select storage_path from photos where storage_path is not null group by 1 having count(*)>1) x`)
await c.end()
