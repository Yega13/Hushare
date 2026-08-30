import pg from 'pg'
import { connectionString } from './scripts/db-connection.mjs'
const c = new pg.Client({ connectionString: connectionString('watch'), ssl: { rejectUnauthorized: false } })
await c.connect()
const q = async (s,p=[]) => (await c.query(s,p)).rows
const started = Date.now()
let lastCount = 0, lastGrowth = Date.now()
const baseline = (await q(`select coalesce(max(created_at), now())::text t from error_events`))[0].t
console.log('watching — baseline', baseline)
while (Date.now() - started < 4 * 3600e3) {
  await new Promise(r => setTimeout(r, 45000))
  const errs = await q(`select created_at, level, source, left(message,120) m, context
    from error_events where created_at > $1::timestamptz order by created_at`, [baseline])
  if (errs.length) {
    console.log('NEW EVENT-TIME REPORTS:')
    for (const e of errs) console.log(e.created_at.toISOString(), e.level, e.source, '|', e.m, '|', JSON.stringify(e.context).slice(0,200))
    process.exit(2)
  }
  const [a] = await q(`select count(*) n from photos p join albums al on al.id=p.album_id where al.custom_slug='vmf-vanadzor-half-marathon'`)
  const n = Number(a.n)
  if (n !== lastCount) { lastGrowth = Date.now(); console.log(new Date().toISOString().slice(11,16), 'photos:', n) }
  if (n === lastCount && n > 1400 && Date.now() - lastGrowth > 25 * 60000) {
    console.log('UPLOAD APPEARS FINISHED at', n, 'photos — no growth for 25 min, zero new errors')
    process.exit(0)
  }
  lastCount = n
}
console.log('watch window ended (4h) — no new errors; photos:', lastCount)
