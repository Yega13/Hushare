// Push the newest local dump to R2 and prune old ones.
//
// A backup that only ever sits on the machine holding the database is not a backup. This puts it
// somewhere else, on a schedule, without anyone having to remember.
//
// WHERE IT GOES: a `db-backups/` prefix inside the bucket named by R2_BACKUP_BUCKET, which is
// REQUIRED and must not be the media bucket. That requirement is not tidiness -- it is the whole
// point of the file, and it is written this way because the earlier version got it wrong:
//
//   This script used to fall back to `R2_BUCKET_NAME || 'hushare-media'` when R2_BACKUP_BUCKET was
//   unset. R2_BACKUP_BUCKET was never actually set as a repository secret, and `hushare-media` is
//   the bucket published at R2_PUBLIC_HOST. So for ten nights every dump -- every owner token and
//   every album password hash in the product -- was uploaded to a public, unauthenticated,
//   date-stamped, enumerable URL. Found 2026-09-04; the objects were moved to a private bucket and
//   the public copies deleted. Nothing in the logs ever said anything was wrong, because from the
//   script's point of view the upload succeeded every single time.
//
// The lesson, and the reason for the two guards below: a default that is *convenient* when config
// is missing is a default that ships when config is missing. For anything holding credentials the
// missing-config branch must REFUSE, loudly, and never guess (AGENTS.md rule 19).
//
// NOT GitHub Actions artifacts, which would be the obvious free answer: artifacts on a PUBLIC
// repository are downloadable by anyone, and a dump contains every owner token and album password
// hash. That would publish exactly what it is meant to protect.
//
// STILL AN HONEST LIMITATION: a separate bucket removes the shared fate with the photos, but not
// with the account. An account compromise or a billing lapse still takes both. A copy in another
// provider's account is the next step whenever that risk is worth ten minutes.
//
// USAGE
//   node scripts/backup-upload.mjs                 upload newest dump from backups/
//   node scripts/backup-upload.mjs --keep 30       change retention (default 30 newest)
//
// ENV: CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BACKUP_BUCKET (required).

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
const bucket = process.env.R2_BACKUP_BUCKET

if (!account || !accessKeyId || !secretAccessKey) {
  console.error('backup-upload: need CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY')
  process.exit(1)
}

// GUARD 1 -- no destination, no upload. Deliberately fatal rather than defaulted: see the incident
// at the top of this file. A failed backup is visible (the job goes red, and the admin heartbeat
// goes stale within a day). A backup written to the wrong bucket is invisible, and was, for ten
// nights.
if (!bucket) {
  console.error('backup-upload: R2_BACKUP_BUCKET is not set.')
  console.error('  This script will NOT guess a bucket. It used to, and it guessed the public one.')
  console.error('  Set it to a PRIVATE bucket with no custom domain and no r2.dev access:')
  console.error('    gh secret set R2_BACKUP_BUCKET      (CI)')
  console.error('    R2_BACKUP_BUCKET=... in .env.local  (local)')
  process.exit(1)
}

// GUARD 2 -- the media bucket is served to the public at R2_PUBLIC_HOST, so it is the one bucket a
// database dump must never enter. Checked by NAME here and proven by an actual unauthenticated
// request after the upload (see assertNotPublic), because a name is a claim and a 200 is a fact.
const mediaBucket = process.env.R2_BUCKET_NAME || 'hushare-media'
if (bucket === mediaBucket) {
  console.error(`backup-upload: refusing to upload dumps to "${bucket}" — that is the public media bucket.`)
  console.error('  A dump holds every owner token and every album password hash. It cannot live behind a public host.')
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

  // Before writing anything sensitive: prove the destination is not served to the internet.
  await assertDestinationNotPublic()

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

// GUARD 3 -- prove it with a CANARY, before the dump is written.
//
// Guards 1 and 2 compare NAMES. A name is a claim about the world: true until somebody renames a
// bucket, repoints R2_PUBLIC_HOST, or copies this script into a second project. What we actually
// need to know is not "the bucket has a different name" but "an unauthenticated stranger cannot
// download from it" -- so ask a stranger's question (AGENTS.md rule 18). The previous version of
// this file passed every name-based check it had and served ten dumps to the internet.
//
// WHY A CANARY, AND NOT THE DUMP ITSELF.
// The first version of this guard uploaded the dump and then fetched the DUMP's public URL. That is
// wrong in a way worth recording, because it reads as more careful than it is: the public host
// resolves to the MEDIA bucket, so a 200 means either "the backup bucket is public" or "something
// unrelated happens to sit at that path" -- and the code could not tell which, yet deleted the
// backup on both. A stale object in a bucket we do not write would have destroyed the night's only
// dump. The uncertain branch has to be the one that does nothing (rule 19), so the check must be
// unambiguous instead of merely cautious.
//
// A random key cannot collide with anything. If a stranger can read THAT, the destination is
// genuinely served to the internet, and no dump has been written yet.
//
// WHICH WAY IT ERRS, and what each costs (rule 19):
//   - canary readable  -> PROVEN public. Refuse before writing the dump. Cost: one missed backup,
//     visible in the admin heartbeat within a day, against publishing every owner token.
//   - canary 403/404   -> proven not served at this host. Upload.
//   - probe cannot run (DNS, timeout, no host, canary write refused) -> WARN and upload anyway.
//     Guards 1 and 2 have already passed, so the likely state is "fine but unproven"; failing here
//     would skip a real backup to punish a DNS hiccup, trading a certain loss for an uncertain one.
//
// HONEST LIMIT: this proves the destination is not served at R2_PUBLIC_HOST. It cannot see a
// DIFFERENT custom domain or an r2.dev URL attached to the backup bucket -- that would need a
// Cloudflare API token, and this job deliberately holds only R2 keys. Whoever attaches a public
// domain to a bucket named "db-backups" is past what a script can defend against.
async function assertDestinationNotPublic() {
  const host = publicHost()
  if (!host) {
    console.warn('  (no R2_PUBLIC_HOST — skipping the publicity check; the backup is unproven, not unsafe)')
    return
  }
  const key = `${PREFIX}.publicity-canary-${Math.random().toString(36).slice(2)}`
  try {
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: 'canary', ContentType: 'text/plain', CacheControl: 'no-store',
    }))
  } catch (e) {
    console.warn(`  (could not write the publicity canary: ${e.message} — proceeding unproven)`)
    return
  }

  let status = null
  try {
    const res = await fetch(`https://${host}/${key}`, { method: 'GET' })
    status = res.status
  } catch (e) {
    console.warn(`  (could not probe ${host}: ${e.message} — proceeding unproven)`)
  }

  // Always clean up the canary, whatever the answer was.
  try {
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: [{ Key: key }] } }))
  } catch (e) {
    console.warn(`  (canary left behind at ${bucket}/${key}: ${e.message})`)
  }

  if (status === null) return
  if (status === 403 || status === 404) {
    console.log(`  verified private: ${host} answers ${status} for a canary written to ${bucket}`)
    return
  }
  console.error(`backup-upload: "${bucket}" IS SERVED PUBLICLY at ${host} (canary answered ${status}).`)
  console.error('  Refusing to write a database dump there. No dump was uploaded.')
  console.error('  A dump holds every owner token and every album password hash.')
  process.exit(1)
}

// The public hostname is configured in exactly one place, wrangler.toml, and read from there rather
// than copied here (AGENTS.md rule 13 -- one fact, one place). An env var wins when set, so CI and
// a future second environment do not need this file to change.
function publicHost() {
  if (process.env.R2_PUBLIC_HOST) return process.env.R2_PUBLIC_HOST
  try {
    const toml = fs.readFileSync('wrangler.toml', 'utf8')
    const m = toml.match(/^\s*R2_PUBLIC_HOST\s*=\s*["']([^"']+)["']/m)
    return m ? m[1] : null
  } catch {
    return null
  }
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
