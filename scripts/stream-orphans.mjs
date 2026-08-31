// WHICH VIDEOS EXIST AT CLOUDFLARE THAT NO ALBUM POINTS AT.
//
// Cloudflare Stream storage is a PURCHASED ceiling — $5 per 1,000 minutes, and exceeding it makes
// every video upload fail for every album. So a video nobody can reach is not merely untidy: it is
// holding a share of a limit that, when it runs out, is an outage.
//
// Measured 2026-09-01: 179 videos at Cloudflare, 155 in the database, 24 orphans holding 6.8
// minutes — 0.7% of the quota. Twenty of the twenty-four arrived in one twenty-minute burst on
// 14 August, all "ready", which is the signature of the bytes landing while the database row was
// never written, not of abandoned uploads.
//
// READ-ONLY BY DEFAULT. It prints what it found and stops. Deleting somebody's video is
// unrecoverable — there is no backup of Stream — so the destructive path needs --delete AND a
// minimum age, and it refuses to touch anything a photos row references.
//
//   node scripts/stream-orphans.mjs                  report only
//   node scripts/stream-orphans.mjs --delete         delete orphans older than 7 days
//   node scripts/stream-orphans.mjs --delete --days 30
//
// Needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_STREAM_TOKEN in .env.local, and the usual DB access.

import fs from 'node:fs'
import pg from 'pg'
import { connectionString } from './db-connection.mjs'

const args = process.argv.slice(2)
const DELETE = args.includes('--delete')
const MIN_AGE_DAYS = (() => {
  const i = args.indexOf('--days')
  const n = i >= 0 ? Number(args[i + 1]) : 7
  return Number.isFinite(n) && n >= 1 ? n : 7
})()

function env() {
  const out = {}
  for (const f of ['.env.local', '.env.development.local']) {
    if (!fs.existsSync(f)) continue
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
  return out
}

const e = env()
const ACC = e.CLOUDFLARE_ACCOUNT_ID
const TOK = e.CLOUDFLARE_STREAM_TOKEN
if (!ACC || !TOK) {
  console.error('Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_STREAM_TOKEN in .env.local')
  process.exit(1)
}

const cf = (path, init) => fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/stream${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${TOK}`, ...(init?.headers ?? {}) },
})

// ── What Cloudflare holds ────────────────────────────────────────────────────────────────────
const listRes = await cf('?limit=1000')
if (!listRes.ok) {
  console.error('Cloudflare list failed:', listRes.status, (await listRes.text()).slice(0, 200))
  process.exit(1)
}
const remote = (await listRes.json()).result ?? []

const usageRes = await cf('/storage-usage')
const usage = usageRes.ok ? (await usageRes.json()).result : null

// ── What the database references ─────────────────────────────────────────────────────────────
//
// EVERY uid the product could possibly mean, not just live photos. A uid still held by a pending
// upload is mid-flight and must never be touched; erring the other way deletes a video somebody is
// in the middle of uploading (rule 19).
const client = new pg.Client({ connectionString: connectionString('stream-orphans'), ssl: { rejectUnauthorized: false } })
await client.connect()
const known = new Set()
for (const q of [
  'select stream_uid as uid from photos where stream_uid is not null',
  'select stream_uid as uid from pending_stream_uploads where stream_uid is not null',
]) {
  try {
    const { rows } = await client.query(q)
    for (const r of rows) known.add(r.uid)
  } catch (err) {
    // A table we cannot read is a REASON TO STOP, not to assume it holds nothing. Assuming empty
    // would classify every live video as an orphan.
    console.error('Could not read', q.split(' from ')[1], '-', err.message)
    console.error('Refusing to continue: an unreadable reference table would make every video look orphaned.')
    await client.end()
    process.exit(1)
  }
}
await client.end()

const now = Date.now()
const orphans = remote
  .filter((v) => !known.has(v.uid))
  .map((v) => ({
    uid: v.uid,
    created: v.created,
    ageDays: (now - Date.parse(v.created)) / 86_400_000,
    state: v.status?.state ?? 'unknown',
    minutes: (v.duration ?? 0) / 60,
    mb: v.size ? v.size / 1e6 : null,
  }))
  .sort((a, b) => a.created.localeCompare(b.created))

const totalMin = orphans.reduce((s, o) => s + o.minutes, 0)

console.log('At Cloudflare :', remote.length)
console.log('Referenced    :', known.size)
console.log('ORPHANED      :', orphans.length, `(${totalMin.toFixed(1)} min)`)
if (usage) {
  console.log('Quota         :', `${usage.totalStorageMinutes?.toFixed(1)} / ${usage.totalStorageMinutesLimit} min`,
    `— orphans are ${(totalMin / (usage.totalStorageMinutesLimit || 1) * 100).toFixed(1)}% of it`)
}
console.log('')

for (const o of orphans) {
  console.log(
    o.uid,
    String(o.created).slice(0, 19),
    `${o.ageDays.toFixed(0)}d`.padStart(5),
    o.state.padEnd(12),
    `${o.minutes.toFixed(2)}min`.padStart(9),
    o.mb ? `${o.mb.toFixed(1)}MB` : '',
  )
}

if (!DELETE) {
  console.log('\nRead-only. Re-run with --delete to remove orphans older than', MIN_AGE_DAYS, 'days.')
  process.exit(0)
}

// ── Deletion ────────────────────────────────────────────────────────────────────────────────
//
// Age is the guard that matters. A uid can exist at Cloudflare seconds before its photos row is
// written — that is the normal upload sequence — so anything recent is presumed in flight.
const doomed = orphans.filter((o) => o.ageDays >= MIN_AGE_DAYS)
const spared = orphans.length - doomed.length
console.log(`\nDeleting ${doomed.length} orphan(s) older than ${MIN_AGE_DAYS} days.`,
  spared ? `${spared} left alone as too recent to be sure.` : '')

let freed = 0
let failed = 0
for (const o of doomed) {
  const res = await cf(`/${o.uid}`, { method: 'DELETE' })
  if (res.ok || res.status === 404) {
    freed += o.minutes
    console.log('deleted', o.uid, `${o.minutes.toFixed(2)}min`)
  } else {
    failed++
    console.error('FAILED ', o.uid, res.status, (await res.text()).slice(0, 120))
  }
}
console.log(`\nFreed ${freed.toFixed(1)} minutes.`, failed ? `${failed} failed.` : '')
