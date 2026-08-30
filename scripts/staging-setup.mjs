// Build the staging database: schema first, then a realistic dataset.
//
//   node scripts/staging-setup.mjs schema     apply schema.sql to the staging database
//   node scripts/staging-setup.mjs seed       fill it with a realistic synthetic dataset
//   node scripts/staging-setup.mjs reset      wipe staging's data and re-seed it
//
// Reads STAGING_DB_URL. Refuses to touch production, loudly, on every command.
//
// WHY SYNTHETIC AND NOT A COPY OF PRODUCTION.
//
// "Copy the database" is the obvious way to build a staging environment and the wrong one here.
// Production rows are real people's email addresses, real album passwords, real owner tokens — the
// tokens ARE the credential, so a copied row is a working key to a stranger's album. Copying them
// doubles the number of places a breach can happen, in a project whose repository is public, to
// gain realism that is not actually needed: architecture work needs the SHAPE of the data — how
// many albums, how many photos each, which features are on — and none of that requires a single
// real person's details.
//
// The shape below is measured from production on 2026-08-30, not invented: 95 albums, ~13,700
// photos, average 212 per album, largest 1,378. Plus the one case production does not have yet and
// the next event does — a 5,000-photo race album with bib search on.
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const PRODUCTION_REF = 'yqngmyjquwemwogdyuwv'
const command = process.argv[2]

const url = process.env.STAGING_DB_URL
if (!url) {
  console.error('STAGING_DB_URL is not set.\n' +
    'Set it to the staging Supabase project\'s pooler connection string, e.g.\n' +
    '  $env:STAGING_DB_URL="postgresql://postgres.<staging-ref>:<password>@<host>:5432/postgres"')
  process.exit(1)
}
// The whole point of this file is destructive commands. Being wrong about which database they
// land in is the failure that ends a product, so it is checked before anything opens a connection.
if (url.includes(PRODUCTION_REF)) {
  console.error('REFUSING TO RUN: STAGING_DB_URL points at the PRODUCTION database (' + PRODUCTION_REF + ').\n' +
    'This script drops and rewrites data. Point it at the staging project.')
  process.exit(1)
}

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
const q = (sql, params = []) => c.query(sql, params).then((r) => r.rows)

// A second, independent check now that a connection is open: ask the database what it is, rather
// than trusting the string we were handed. A pooler hostname can hide the project ref.
const [{ current_database: dbName }] = await q('select current_database()')
const [counts] = await q(`select
  (select count(*) from information_schema.tables where table_schema='public') tables,
  (select count(*) from pg_class where relname='albums') has_albums`)
console.log(`connected to "${dbName}" — ${counts.tables} public tables`)

async function applySchema() {
  const sql = readFileSync('schema.sql', 'utf8')
  console.log('applying schema.sql...')
  await c.query(sql)
  const [t] = await q(`select count(*) n from information_schema.tables where table_schema='public'`)
  console.log(`done — ${t.n} tables`)
}

async function wipe() {
  // Order matters only where foreign keys do; truncate cascade handles the rest in one statement.
  const tables = (await q(`select tablename from pg_tables where schemaname='public'`)).map((r) => r.tablename)
  if (tables.length === 0) { console.log('nothing to wipe'); return }
  await c.query(`truncate ${tables.map((t) => `public."${t}"`).join(', ')} cascade`)
  console.log(`wiped ${tables.length} tables`)
}

// Measured from production, so staging behaves like the real thing under the same shapes.
// The counts matter less than the VARIETY. A deletion bug is caught by having many albums, so a
// mis-scoped delete visibly takes out ones it should not. An access-control bug is caught by having
// albums a visitor is not supposed to open. Neither is caught by realistic email addresses, which
// is the only thing copying production would actually add.
const SHAPE = {
  albums: 95,
  avgPhotos: 212,
  largestAlbum: 1378,
  raceAlbumPhotos: 5000,   // the case production has not hit yet and the next event will
  // Each of these is a DIFFERENT branch through the gate, reproduced from a real count in
  // production. An album with no password is not a test of an album with one.
  withPassword: 8,         // gateAllowsContribution takes the password branch
  withReveal: 1,           // sealed until a date - the branch that locks an owner out if gated wrongly
  moderated: 1,            // require_approval: photos land hidden
  customUrl: 8,            // resolved by custom_slug rather than slug
  guestOwned: 66,          // user_id null - every tier lookup must survive it
  distinctOwners: 14,      // so a cross-owner leak shows up as A seeing B's album
  hiddenPhotos: 40,        // guests must never receive these; owners must
  videos: 132,             // Stream-backed: a different delete path from R2
}

async function seed() {
  console.log('seeding a synthetic dataset shaped like production...')
  // One placeholder image for every row. Staging's bucket is its own and starts empty, so nothing
  // here points at a production file — a broken thumbnail in staging is correct, and far better
  // than staging quietly reading real customers' photos.
  const img = `https://media-staging.hushare.space/placeholder/tile.jpg`
  const thumb = `https://media-staging.hushare.space/placeholder/tile-thumb.jpg`

  // Synthetic owners. No real user row is copied - an account here is an id and nothing else,
  // which is all the tier lookups and ownership checks ever read.
  const owners = Array.from({ length: SHAPE.distinctOwners }, () => randomUUID())

  let totalPhotos = 0
  for (let i = 0; i < SHAPE.albums; i++) {
    const isRace = i === 0
    const n = isRace ? SHAPE.raceAlbumPhotos
      : i === 1 ? SHAPE.largestAlbum
      : Math.max(1, Math.round(SHAPE.avgPhotos * (0.15 + Math.random() * 1.8)))
    // Deterministic, not random: `reset` must produce the same world twice, or a bug found on
    // Tuesday is gone on Wednesday for reasons nobody can reconstruct.
    const hasPassword = i > 1 && i < 2 + SHAPE.withPassword
    const hasReveal = i === 2 + SHAPE.withPassword
    const isModerated = i === 3 + SHAPE.withPassword
    const hasCustomUrl = i > 4 + SHAPE.withPassword && i <= 4 + SHAPE.withPassword + SHAPE.customUrl
    const ownerId = i < SHAPE.albums - SHAPE.guestOwned ? owners[i % owners.length] : null
    const [alb] = await q(
      `insert into albums (slug, custom_slug, title, owner_token, user_id, password_hash, reveal_at,
                           require_approval, bib_search_enabled, bib_min, bib_max, photo_layout)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'grid') returning id`,
      [`stg${i.toString().padStart(4, '0')}`,
       hasCustomUrl ? `custom-${i}` : null,
       isRace ? 'Race (5,000 photos)' : `Album ${i}`,
       randomUUID(), ownerId,
       // A hash-SHAPED placeholder, never a real hash and never a real password. Nothing in staging
       // needs unlocking; the code paths need password_hash non-null so the gate takes its locked
       // branch.
       hasPassword ? `staging-not-a-real-hash-${i}` : null,
       hasReveal ? new Date(Date.now() + 7 * 864e5).toISOString() : null,
       isModerated, isRace, isRace ? 1 : null, isRace ? 5000 : null])
    // generate_series does the whole album in one statement — 5,000 rows in well under a second,
    // where row-by-row inserts would take minutes and make a reset something nobody does.
    // Every Nth photo hidden, so a guest-facing read that forgets `.eq('hidden', false)` shows up
    // as guests seeing photos an owner withheld - the exact class of bug that reached production in
    // api/album/face-search.
    const hideEvery = Math.max(2, Math.ceil((n * SHAPE.albums) / Math.max(1, SHAPE.hiddenPhotos)))
    await q(
      `insert into photos (album_id, storage_path, url, thumb_url, media_type, width, height, sort_order, bib_numbers, hidden, created_at)
       select $1, 'staging/' || $2 || '/' || g, $3, $4, 'image', 3000, 2000, g,
              case when $5 then array[lpad(g::text, 5, '0')] else null end,
              (g % $7 = 0),
              now() - (g || ' minutes')::interval
       from generate_series(1, $6) g`,
      [alb.id, alb.id, img, thumb, isRace, n, hideEvery])
    totalPhotos += n
  }

  // Videos last and separately: they are Stream-backed, which is a DIFFERENT deletion path from R2
  // (deleteStreamVideo, not a bucket key). A seed without them exercises half of delete.
  const [videoAlbum] = await q(`select id from albums order by slug limit 1`)
  await q(
    `insert into photos (album_id, storage_path, url, media_type, stream_uid, stream_iframe_url,
                         duration_seconds, width, height, sort_order, created_at)
     select $1, null, null, 'video', 'staging-uid-' || g,
            'https://customer-staging.cloudflarestream.com/' || g || '/iframe',
            16, 1920, 1080, 100000 + g, now() - (g || ' minutes')::interval
     from generate_series(1, $2) g`,
    [videoAlbum.id, SHAPE.videos])
  totalPhotos += SHAPE.videos
  console.log(`seeded ${SHAPE.albums} albums, ${totalPhotos.toLocaleString('en-US')} photos`)
  console.log(`  including one ${SHAPE.raceAlbumPhotos.toLocaleString('en-US')}-photo race album with bib search on (slug: stg0000)`)
  console.log(`  ${SHAPE.withPassword} password-locked, 1 sealed behind a reveal date, 1 moderated,`)
  console.log(`  ${SHAPE.customUrl} on custom URLs, ${SHAPE.guestOwned} guest-owned across ${SHAPE.distinctOwners} accounts,`)
  console.log(`  ${SHAPE.videos} Stream-backed videos, hidden photos scattered throughout.`)
}

try {
  if (command === 'schema') await applySchema()
  else if (command === 'seed') await seed()
  else if (command === 'reset') { await wipe(); await seed() }
  else {
    console.error('usage: node scripts/staging-setup.mjs <schema|seed|reset>')
    process.exitCode = 1
  }
} finally {
  await c.end()
}
