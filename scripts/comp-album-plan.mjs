// Give ONE album a paid plan, for free, by hand.
//
// This writes albums.package_tier and package_expires_at — the same two columns a real Polar
// purchase writes, and the same ones albumEffectiveTier reads. So a comped album is Pro or Max in
// every way the product can observe: the item cap, the per-file size caps, the video budget, the
// paid features, and exemption from inactivity retirement all follow from these two values.
//
// WHAT IT IS FOR: a friend, a partner, a collaboration, or an apology — the policy where an album
// that suffered our errors gets a raised ceiling. It is not a pricing tier and not a substitute for
// one.
//
// WHY A SCRIPT AND NOT A BUTTON: AGENTS.md rule 26. Comping a plan is changing what somebody is
// entitled to, and that is never a thing to do on an assumption or as a side effect of some other
// fix. It has to be a deliberate act, run by hand, with the album named out loud.
//
// SAFE AGAINST THE MONEY PATHS, checked rather than assumed:
//   * package_last_order_id is left NULL. refundOutcome only revokes when a refunded order's id
//     MATCHES that column, so no refund of anyone's order can ever strip a comp.
//   * The nightly package reconcile only applies orders it finds in Polar's ledger. There is no
//     order for a comped album, so it will never see it, never re-grant it and never revoke it.
//   * A LATER REAL PURCHASE IS NOT LOST: applyPackageGrant never lowers the tier and extends time
//     from whatever is left, so if this album is comped Pro and later buys Max, it becomes Max.
//
// USAGE
//   node scripts/comp-album-plan.mjs <slug>                     show the album's current state
//   node scripts/comp-album-plan.mjs <slug> --pro               Pro, for the default 2 years
//   node scripts/comp-album-plan.mjs <slug> --max --years 1     Max, for one year
//   node scripts/comp-album-plan.mjs <slug> --clear             back to ordinary rules
//
// <slug> accepts either the random slug or a custom URL.

import pg from 'pg'
import { connectionString } from './db-connection.mjs'

// Two years, matching what a purchased Package grants — so a comp and a sale age the same way and
// nobody has to remember which this album was.
const DEFAULT_YEARS = 2
// A comp is a decision about one album, not a way to create a permanent free account. Ten years is
// far beyond any event and still finite, so a typo cannot produce an album nothing ever reclaims.
const MAX_YEARS = 10

const [, , rawSlug, ...rest] = process.argv
if (!rawSlug) {
  console.error('usage: node scripts/comp-album-plan.mjs <slug> [--pro|--max|--clear] [--years <n>]')
  process.exit(1)
}

let tier = null
let clear = false
let years = DEFAULT_YEARS
for (let i = 0; i < rest.length; i++) {
  const arg = rest[i]
  if (arg === '--pro') tier = 'pro'
  else if (arg === '--max') tier = 'studio'          // 'studio' is Max's name in the database
  else if (arg === '--clear') clear = true
  else if (arg === '--years') {
    years = Number(rest[++i])
    if (!Number.isInteger(years) || years <= 0 || years > MAX_YEARS) {
      console.error(`--years needs a whole number between 1 and ${MAX_YEARS}`)
      process.exit(1)
    }
  } else {
    console.error(`unknown option ${arg} — expected --pro, --max, --clear or --years <n>`)
    process.exit(1)
  }
}
if (tier && clear) {
  console.error('--clear cannot be combined with --pro or --max')
  process.exit(1)
}

const slug = rawSlug.trim().toLowerCase().replace(/^https?:\/\/[^/]+\//, '')
const client = new pg.Client({ connectionString: connectionString('comp-album-plan'), ssl: { rejectUnauthorized: false } })
await client.connect()

const SELECT = `select id, slug, custom_slug, title, user_id, package_tier, package_expires_at,
                       package_last_order_id, media_cap_override,
                       (select count(*) from photos p where p.album_id = a.id) as items
                  from albums a`

const { rows } = await client.query(
  `${SELECT} where (a.slug = $1 or a.custom_slug = $1) and a.retired_at is null`,
  [slug],
)
if (rows.length === 0) {
  console.error(`no live album with slug or custom URL "${slug}"`)
  await client.end()
  process.exit(1)
}
// A custom URL is unique and a slug is unique, but a custom URL COULD equal another album's slug.
// Refusing beats guessing when the next step changes what somebody is entitled to.
if (rows.length > 1) {
  console.error(`"${slug}" matches ${rows.length} albums — refusing to guess which one you meant`)
  await client.end()
  process.exit(1)
}
const album = rows[0]

const show = (a) => {
  console.log(`  ${a.title}`)
  console.log(`  slug:      ${a.slug}${a.custom_slug ? ` (custom: ${a.custom_slug})` : ''}`)
  console.log(`  account:   ${a.user_id ? 'claimed' : 'ANONYMOUS — no account, so no way to email this owner'}`)
  console.log(`  items:     ${a.items}`)
  // toISOString, not String(...).slice(0,10). pg hands back a Date, whose toString begins
  // "Fri Sep 01 2028" — so slicing ten characters printed "Fri Sep 01" and HID THE YEAR, on the one
  // line that says how long this album has been given. A comp for two years and a comp for two days
  // looked identical.
  const until = a.package_expires_at ? new Date(a.package_expires_at).toISOString().slice(0, 10) : null
  console.log(`  plan:      ${a.package_tier ? `${a.package_tier === 'studio' ? 'Max' : 'Pro'} until ${until}` : 'none (ordinary tier rules apply)'}`)
  console.log(`  paid?      ${a.package_last_order_id ? `yes — Polar order ${a.package_last_order_id}` : 'no order — a comp, or never purchased'}`)
  console.log(`  override:  ${a.media_cap_override ?? 'none'}`)
}

if (!tier && !clear) {
  console.log('\nCurrent state:')
  show(album)
  console.log('\nPass --pro or --max to comp a plan, or --clear to remove one.\n')
  await client.end()
  process.exit(0)
}

// NEVER CLEAR SOMETHING THAT WAS PAID FOR. package_last_order_id is set only by the webhook, so its
// presence means real money. Taking that away by hand is the one mistake here that costs a customer
// something they bought (rule 19).
if (clear && album.package_last_order_id) {
  console.error(`\nREFUSING: this album's plan came from Polar order ${album.package_last_order_id}.`)
  console.error('That is a purchase, not a comp. Clearing it would take away something paid for.\n')
  await client.end()
  process.exit(1)
}

const expires = clear ? null : new Date(Date.now() + years * 365 * 24 * 60 * 60 * 1000).toISOString()
await client.query(
  'update albums set package_tier = $2, package_expires_at = $3 where id = $1',
  [album.id, clear ? null : tier, expires],
)

const { rows: after } = await client.query(`${SELECT} where a.id = $1`, [album.id])
console.log(clear ? '\nPlan cleared:' : `\nComped ${tier === 'studio' ? 'Max' : 'Pro'} for ${years} year${years === 1 ? '' : 's'}:`)
show(after[0])
console.log()
await client.end()
