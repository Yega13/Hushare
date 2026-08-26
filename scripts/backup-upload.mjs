// Push the newest local dump to R2 and prune old ones.
//
// A backup that only ever sits on the machine holding the database is not a backup. This puts it
// somewhere else, on a schedule, without anyone having to remember.
//
// WHERE IT GOES, and the honest limitation: the default is a `db-backups/` prefix in the same R2
// bucket as the photos. That is off-machine and durable, but it is NOT independent -- an account
// compromise or a billing lapse takes the media and the database backups together. Set
// R2_BACKUP_BUCKET to a separate bucket to remove that shared fate. Doing so is worth ten minutes
// the day the account matters.
//
// NOT GitHub Actions artifacts, which would be the obvious free answer: artifacts on a PUBLIC
// repository are downloadable by anyone, and a dump contains every owner token and album password
// hash. That would publish exactly what it is meant to protect.
//
// USAGE
//   node scripts/backup-upload.mjs                 upload newest dump from backups/
//   node scripts/backup-upload.mjs --keep 30       change retention (default 30 newest)
//
// ENV: CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, optional R2_BACKUP_BUCKET.

import fs from 'node:fs'
import path from 'node:path'
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3'

const args = process.argv.slice(2)
const keepIdx = args.indexOf('--keep')
const KEEP = keepIdx >= 0 && args[keepIdx + 1] ? Number(args[keepIdx + 1]) : 30
const PREFIX = 'db-backups/'

const account = process.env.CLOUDFLARE_ACCOUNT_ID
const accessKeyId = process.env.R2_ACCESS_KEY_ID
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
const bucket = process.env.R2_BACKUP_BUCKET || process.env.R2_BUCKET_NAME || 'hushare-media'

if (!account || !accessKeyId || !secretAccessKey) {
  console.error('backup-upload: need CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY')
  process.exit(1)
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${account}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
})

async function main() {
  const dir = 'backups'
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.json.gz')).sort()
    : []
  if (files.length === 0) {
    console.error('backup-upload: no dump found in backups/ — run `npm run backup` first')
    process.exit(1)
  }
  const newest = files[files.length - 1]
  const body = fs.readFileSync(path.join(dir, newest))

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: `${PREFIX}${newest}`,
    Body: body,
    ContentType: 'application/gzip',
    // The bucket is private, but say it anyway: this object must never be served to anyone.
    CacheControl: 'no-store',
  }))
  console.log(`  uploaded ${newest} (${(body.length / 1024).toFixed(0)} KB) to ${bucket}/${PREFIX}`)

  // Retention. Without it a nightly job quietly accumulates forever, and the thing that was meant
  // to cost nothing becomes a line on the bill.
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX }))
  const keys = (listed.Contents ?? [])
    .map(o => o.Key)
    .filter((k) => typeof k === 'string')
    .sort()
  const stale = keys.slice(0, Math.max(0, keys.length - KEEP))
  if (stale.length > 0) {
    await s3.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: stale.map(Key => ({ Key })) },
    }))
    console.log(`  pruned ${stale.length} old backup(s), keeping the newest ${KEEP}`)
  }
  console.log(`  ${Math.min(keys.length, KEEP)} backup(s) now stored remotely`)

  await recordHeartbeat(newest, body.length)
}

// Record that a backup actually LANDED SOMEWHERE OTHER THAN THE MACHINE THAT MADE IT.
//
// The nightly job failed silently on 2026-08-25 and 2026-08-26 and nobody noticed for two days.
// The dump step succeeded both times, so the log looked busy; the upload step then exited because
// the R2 credentials were not set as repository secrets, and the dump was thrown away with the
// runner. Two nights of believing there was a backup, with none.
//
// A failure nobody sees is worse than no backup at all, because it removes the worry that would
// have made someone check. So success — not the attempt — writes a heartbeat the admin dashboard
// reads, and the dashboard goes red when it goes stale. The thing that notices is now on the page
// the owner already looks at every day, rather than an email from GitHub about a cron.
//
// Deliberately non-fatal: if this write fails, the backup still happened and is still safe in R2.
// Failing the job here would report a disaster that did not occur.
async function recordHeartbeat(file, bytes) {
  if (!process.env.SUPABASE_DB_URL) {
    console.warn('  (no SUPABASE_DB_URL — backup is uploaded but the admin heartbeat was not written)')
    return
  }
  try {
    const { default: pg } = await import('pg')
    const { connectionString } = await import('./db-connection.mjs')
    const client = new pg.Client({
      connectionString: connectionString('backup-upload'),
      ssl: { rejectUnauthorized: false },
    })
    await client.connect()
    await client.query(
      `insert into public.system_state (key, value, updated_at)
       values ('last_backup_at', $1, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [JSON.stringify({ at: new Date().toISOString(), file, bytes })],
    )
    await client.end()
    console.log('  heartbeat recorded (admin will show this as the last successful backup)')
  } catch (e) {
    console.warn('  heartbeat not recorded:', e.message)
  }
}

main().catch(e => { console.error('backup-upload failed:', e.message); process.exitCode = 1 })
