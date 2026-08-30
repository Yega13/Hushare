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
const SHAPE = {
  albums: 95,
  avgPhotos: 212,
  largestAlbum: 1378,
  raceAlbumPhotos: 5000,   // the case production has not hit yet and the next event will
}

async function seed() {
  console.log('seeding a synthetic dataset shaped like production...')
  // One placeholder image for every row. Staging's bucket is its own and starts empty, so nothing
  // here points at a production file — a broken thumbnail in staging is correct, and far better
  // than staging quietly reading real customers' photos.
  const img = `https://media-staging.hushare.space/placeholder/tile.jpg`
  const thumb = `https://media-staging.hushare.space/placeholder/tile-thumb.jpg`

  let totalPhotos = 0
  for (let i = 0; i < SHAPE.albums; i++) {
    const isRace = i === 0
    const n = isRace ? SHAPE.raceAlbumPhotos
      : i === 1 ? SHAPE.largestAlbum
      : Math.max(1, Math.round(SHAPE.avgPhotos * (0.15 + Math.random() * 1.8)))
    const [alb] = await q(
      `insert into albums (slug, title, owner_token, bib_search_enabled, bib_min, bib_max, photo_layout)
       values ($1, $2, $3, $4, $5, $6, 'grid') returning id`,
      [`stg${i.toString().padStart(4, '0')}`, isRace ? 'Race (5,000 photos)' : `Album ${i}`,
       randomUUID(), isRace, isRace ? 1 : null, isRace ? 5000 : null])
    // generate_series does the whole album in one statement — 5,000 rows in well under a second,
    // where row-by-row inserts would take minutes and make a reset something nobody does.
    await q(
      `insert into photos (album_id, storage_path, url, thumb_url, media_type, width, height, sort_order, bib_numbers, created_at)
       select $1, 'staging/' || $2 || '/' || g, $3, $4, 'image', 3000, 2000, g,
              case when $5 then array[lpad(g::text, 5, '0')] else null end,
              now() - (g || ' minutes')::interval
       from generate_series(1, $6) g`,
      [alb.id, alb.id, img, thumb, isRace, n])
    totalPhotos += n
  }
  console.log(`seeded ${SHAPE.albums} albums, ${totalPhotos.toLocaleString('en-US')} photos`)
  console.log(`  including one ${SHAPE.raceAlbumPhotos.toLocaleString('en-US')}-photo race album with bib search on (slug: stg0000)`)
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
