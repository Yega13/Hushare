import pg from 'pg'
import { connectionString } from './scripts/db-connection.mjs'
const c = new pg.Client({ connectionString: connectionString('audit'), ssl: { rejectUnauthorized: false } })
await c.connect()
const r = await c.query(`select slug, title, left(body, 4000) body from statements order by created_at desc limit 5`).catch(e=>({rows:[{err:e.message}]}))
for (const row of r.rows) { console.log('=== ' + (row.slug||row.err) + ' | ' + (row.title||'')); console.log(row.body||'') }
await c.end()
