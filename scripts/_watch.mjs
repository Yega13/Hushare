import pg from 'pg'
import { connectionString } from './db-connection.mjs'
const IDLE_MIN = 10, MAX_MIN = 55, POLL_MS = 120000
const started = Date.now()
async function poll() {
  const c = new pg.Client({ connectionString: connectionString('watch'), ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const a = (await c.query(`select id,(select count(*) from photos p where p.album_id=a.id) ph from albums a where a.slug='bjn88ena'`)).rows[0]
    const last = (await c.query(`select max(created_at) m from photos where album_id=$1`, [a.id])).rows[0].m
    const idle = (Date.now() - new Date(last).getTime()) / 60000
    return { photos: a.ph, idle }
  } finally { await c.end() }
}
for (;;) {
  const { photos, idle } = await poll()
  const mins = (Date.now() - started) / 60000
  console.log(`[${new Date().toISOString().slice(11,19)}] photos=${photos} idle=${idle.toFixed(1)}min`)
  if (idle >= IDLE_MIN) { console.log(`\nUPLOAD FINISHED — quiet for ${idle.toFixed(0)} min, album ended at ${photos} photos. Safe to deploy.`); break }
  if (mins >= MAX_MIN) { console.log(`\nWATCH TIMED OUT after ${mins.toFixed(0)} min — still active (${photos} photos, idle ${idle.toFixed(1)}min). Do NOT deploy yet.`); break }
  await new Promise(r => setTimeout(r, POLL_MS))
}
