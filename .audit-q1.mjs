import pg from 'pg'
import { connectionString } from './scripts/db-connection.mjs'
const c = new pg.Client({ connectionString: connectionString('audit'), ssl: { rejectUnauthorized: false } })
await c.connect()
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log('\n### ' + label); console.table(r.rows) }
  catch (e) { console.log('\n### ' + label + ' -> ERROR: ' + e.message) }
}
await q('album totals', `
  select count(*) total,
         count(*) filter (where user_id is null) guest_albums,
         count(*) filter (where retired_at is not null) retired,
         count(*) filter (where last_notification_at is not null) warned
  from albums`)
await q('guest albums + photos', `
  select count(distinct a.id) guest_albums, count(p.id) photos
  from albums a left join photos p on p.album_id=a.id
  where a.user_id is null and a.retired_at is null`)
await q('guest albums by activity age', `
  select case
    when a.last_activity_at < now()-interval '365 days' then 'a: >365d (past retention)'
    when a.last_activity_at < now()-interval '335 days' then 'b: 335-365d (warn window)'
    when a.last_activity_at < now()-interval '180 days' then 'c: 180-335d'
    else 'd: <180d' end bucket,
    count(*) albums, sum(pc.n) photos
  from albums a
  left join lateral (select count(*) n from photos p where p.album_id=a.id) pc on true
  where a.user_id is null and a.retired_at is null
  group by 1 order by 1`)
await q('registered-free albums never warned but past 335d', `
  select count(*) from albums
  where user_id is not null and retired_at is null
    and last_notification_at is null and last_activity_at < now()-interval '335 days'`)
await q('albums eligible for deletion tonight', `
  select count(*) from albums
  where retired_at is null and last_activity_at < now()-interval '365 days'
    and last_notification_at is not null and last_notification_at < now()-interval '30 days'`)
await c.end()
