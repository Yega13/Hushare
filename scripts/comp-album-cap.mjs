// Give ONE album a bigger upload ceiling, by hand.
//
// albums.media_cap_override is read by albumCap() (src/lib/album-entitlements.ts) and outranks
// every tier, every grandfathering rule and every package — it is the deliberate "this album is a
// special case" lever. There was no way to set it, so the column existed and nothing wrote it.
//
// WHAT IT IS FOR: a partner album, an event we are sponsoring, or an apology — a customer whose
// uploads failed for our reasons should not then meet a wall while they retry. It is not a pricing
// tier and it is not a substitute for one: it applies to a single album and it is invisible to
// everyone except the person who runs this.
//
// WHAT IT DOES NOT DO: it does not change the album's PLAN. Face Finder, bib search, custom URLs
// and branding all stay exactly where the album's tier and package leave them. This is only how
// many photos and videos may be added, which is the one thing a full album needs.
//
// The ceiling is MAX_MEDIA_CAP_OVERRIDE (200,000) so a typo cannot create an unbounded-cost album.
//
// USAGE
//   node scripts/comp-album-cap.mjs <slug>              show the album's current state
//   node scripts/comp-album-cap.mjs <slug> --cap 1000   set the ceiling
//   node scripts/comp-album-cap.mjs <slug> --clear      hand it back to the ordinary rules
//
// <slug> accepts either the random slug or a custom URL.

import pg from 'pg'
import { connectionString } from './db-connection.mjs'

// Mirrors MAX_MEDIA_CAP_OVERRIDE in src/lib/album-entitlements.ts. Duplicated because a script
// cannot import TypeScript; the number is asserted against the real one by
// tests/comp-script-cap.test.ts so the two cannot drift (rule 13).
const MAX_CAP = 200_000

const [, , rawSlug, flag, value] = process.argv
if (!rawSlug) {
  console.error('usage: node scripts/comp-album-cap.mjs <slug> [--cap <n> | --clear]')
  process.exit(1)
}
if (flag && flag !== '--cap' && flag !== '--clear') {
  console.error(`unknown option ${flag} — expected --cap <n> or --clear`)
  process.exit(1)
}

let newCap = null
if (flag === '--cap') {
  newCap = Number(value)
  if (!Number.isInteger(newCap) || newCap <= 0 || newCap > MAX_CAP) {
    console.error(`--cap needs a whole number between 1 and ${MAX_CAP.toLocaleString('en-US')}`)
    process.exit(1)
  }
}

const slug = rawSlug.trim().toLowerCase().replace(/^https?:\/\/[^/]+\//, '')
const client = new pg.Client({ connectionString: connectionString('comp-album-cap'), ssl: { rejectUnauthorized: false } })
await client.connect()

const { rows } = await client.query(
  `select id, slug, custom_slug, title, user_id, media_cap_override,
          (select count(*) from photos p where p.album_id = a.id) as items
     from albums a
    where (a.slug = $1 or a.custom_slug = $1) and a.retired_at is null`,
  [slug],
)
if (rows.length === 0) {
  console.error(`no live album with slug or custom URL "${slug}"`)
  await client.end()
  process.exit(1)
}
const album = rows[0]

const show = (a) => {
  console.log(`  ${a.title}`)
  console.log(`  slug:      ${a.slug}${a.custom_slug ? ` (custom: ${a.custom_slug})` : ''}`)
  console.log(`  account:   ${a.user_id ? 'claimed' : 'ANONYMOUS — no account, so no way to email this owner'}`)
  console.log(`  items:     ${a.items}`)
  console.log(`  override:  ${a.media_cap_override ?? 'none (ordinary tier rules apply)'}`)
}

if (!flag) {
  console.log('\nCurrent state:')
  show(album)
  console.log('\nPass --cap <n> to raise the ceiling, or --clear to remove it.\n')
  await client.end()
  process.exit(0)
}

await client.query('update albums set media_cap_override = $2 where id = $1', [album.id, newCap])
const { rows: after } = await client.query(
  `select id, slug, custom_slug, title, user_id, media_cap_override,
          (select count(*) from photos p where p.album_id = a.id) as items
     from albums a where a.id = $1`,
  [album.id],
)
console.log(newCap === null ? '\nOverride cleared:' : `\nCeiling set to ${newCap.toLocaleString('en-US')}:`)
show(after[0])
console.log()
await client.end()
