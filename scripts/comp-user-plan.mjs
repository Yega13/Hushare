// Give ONE ACCOUNT a paid plan, for free, by hand.
//
// This writes a row into `subscriptions` — the same table a real Polar subscription writes, and the
// same one computeUserTier reads. So a comped account is Pro or Max in every way the product can
// observe: every album they own, every per-tier cap, every paid feature, and exemption from
// inactivity retirement.
//
// WHY THIS EXISTS SEPARATELY FROM comp-album-plan.mjs. That script comps ONE ALBUM. An account comp
// is a different thing: it follows the person, covers albums they have not made yet, and is what
// you want when the gesture is "thank you" rather than "this particular event is on us". Comping
// eleven albums one at a time to say thank you to one person is the wrong tool, and it was the
// first thing I reached for.
//
// WHY A SCRIPT AND NOT A BUTTON: AGENTS.md rule 26. Granting entitlements is never a side effect.
//
// SAFE AGAINST THE MONEY PATHS, read out of the code rather than assumed:
//   * polar_subscription_id gets a `comp-` prefix. src/lib/server/polar-reconcile.ts only UPDATES
//     rows whose polar_subscription_id matches a subscription it found in Polar's ledger, and only
//     DELETES rows matching 'manual-recovery-%'. A comp- row is invisible to both.
//   * There is no order id anywhere on this row, so no refund of anyone's order can strip it.
//   * A LATER REAL PURCHASE IS NOT BLOCKED. computeUserTier takes the HIGHEST active tier across
//     all of a user's rows, so a comped Pro sitting beside a real Max resolves to Max.
//   * EXPIRY IS REAL. isSubActive treats a null current_period_end as "valid forever" — that is how
//     the existing hand-made comp in this database was recorded — so this script always writes a
//     real date instead, and the grant genuinely ends.
//
// USAGE
//   node scripts/comp-user-plan.mjs <email>                    show what they have now
//   node scripts/comp-user-plan.mjs <email> --pro --years 1    one year of Pro
//   node scripts/comp-user-plan.mjs <email> --max --years 2    two years of Max
//   node scripts/comp-user-plan.mjs <email> --max --months 1 --on-top
//                                                              Max for a month ALONGSIDE the plan
//                                                              they already pay for, billing
//                                                              untouched
//   node scripts/comp-user-plan.mjs <email> --clear            remove comps this script made

import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { connectionString } from './db-connection.mjs'

// The prefix that marks a row as ours. Asserted against polar-reconcile's own filters by
// tests/comp-user-plan.test.ts, so a change to either side fails loudly rather than quietly
// handing the nightly job permission to delete somebody's gift.
// TWO MARKERS, TWO NAMES, AND NEITHER IS CALLED COMP_PREFIX ANY MORE.
//
// lib/subscription-origin exports `COMP_PREFIX = 'comp'` -- bare, because it has to recognise both
// shapes this script has ever written. This file had its own `COMP_PREFIX = 'comp-'`: the same name
// holding a different string, which is the kind of thing somebody reads once and assumes about
// forever. Renamed rather than reconciled, because the VALUES are deliberately different and it is
// only the name that lied.
//
// The bytes written are unchanged. This script inserts against the live database, and a cosmetic
// tidy is not a reason to change what a row looks like -- existing rows carry these exact shapes.
//
// tests/comp-user-plan.test.ts asserts both of them still begin with the module's COMP_PREFIX. A
// .mjs cannot import a .ts, so that test reading the real source IS the mechanism rule 13 allows
// when the fact genuinely cannot be imported.

/** polar_subscription_id: 'comp-<uuid>'. The dash matters -- polar-reconcile's DELETE pattern is
 *  'manual-recovery-%', and the whole safety argument in the header is that no filter matches this. */
const COMP_SUBSCRIPTION_PREFIX = 'comp-'

/** polar_product_id: the bare marker, written exactly like this since the first hand-made comp.
 *  It is the one the admin dashboard read with startsWith('comp-') and therefore never matched --
 *  two gifts counted as revenue until 2026-09-11. */
const COMP_PRODUCT_ID = 'comp'

const [, , email, ...rest] = process.argv
if (!email || email.startsWith('--')) {
  console.error('usage: node scripts/comp-user-plan.mjs <email> [--pro | --max] [--years N] [--clear]')
  process.exit(1)
}

const flags = new Set(rest.filter((a) => a.startsWith('--')))
const valueOf = (name, fallback) => {
  const i = rest.indexOf(name)
  return i === -1 ? fallback : rest[i + 1]
}

const known = new Set(['--pro', '--max', '--clear', '--years', '--months', '--on-top'])
for (const f of flags) {
  if (!known.has(f)) { console.error(`unknown option ${f}`); process.exit(1) }
}
if (flags.has('--pro') && flags.has('--max')) {
  console.error('pick one of --pro or --max, not both'); process.exit(1)
}
if (flags.has('--years') && flags.has('--months')) {
  console.error('pick one of --years or --months, not both'); process.exit(1)
}

// MONTHS EXIST BECAUSE A TRIAL IS NOT A YEAR. Giving a paying customer a taste of the tier above
// theirs is a month-shaped gesture; --years could only express it as a fraction nobody would type.
const usingMonths = flags.has('--months')
const rawAmount = usingMonths ? valueOf('--months', '1') : valueOf('--years', '1')
const amount = Number(rawAmount)
const limit = usingMonths ? 24 : 10
if (!Number.isInteger(amount) || amount < 1 || amount > limit) {
  console.error(`${usingMonths ? '--months' : '--years'} must be a whole number from 1 to ${limit}, got ${rawAmount}`)
  process.exit(1)
}

const tier = flags.has('--max') ? 'studio' : flags.has('--pro') ? 'pro' : null
const clearing = flags.has('--clear')
if (tier && clearing) { console.error('--clear cannot be combined with a tier'); process.exit(1) }

/**
 * Where the grant ends.
 *
 * DUPLICATED FROM extendExpiry in src/lib/package-catalogue.ts, which a .mjs script cannot import,
 * and held to it by tests/comp-user-plan.test.ts — the same arrangement comp-album-cap.mjs uses for
 * MAX_MEDIA_CAP_OVERRIDE (rule 13's escape hatch).
 *
 * Extending from the CURRENT expiry when one is still in the future means comping twice never costs
 * somebody time they already had, and re-running this after a lapse starts from today rather than
 * selling a year that is already partly gone.
 */
function extendExpiry(currentExpiry, yearsToAdd, now) {
  const from = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now
  const out = new Date(from.getTime())
  out.setUTCFullYear(out.getUTCFullYear() + yearsToAdd)
  return out
}

/**
 * The same idea in months, with the rollover that setUTCMonth does on its own clamped.
 *
 * Adding one month to the 31st of January gives the 3rd of March, because February has no 31st and
 * Date rolls forward rather than failing — the identical trap spokenDate hit in the outreach engine.
 * A grant made on the 31st must not quietly last three days longer than one made on the 30th, so
 * the day is pinned to the end of the target month instead.
 */
function extendExpiryMonths(currentExpiry, monthsToAdd, now) {
  const from = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now
  const day = from.getUTCDate()
  const out = new Date(from.getTime())
  out.setUTCDate(1)
  out.setUTCMonth(out.getUTCMonth() + monthsToAdd)
  const lastDayOfTarget = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate()
  out.setUTCDate(Math.min(day, lastDayOfTarget))
  return out
}

const client = new pg.Client({ connectionString: connectionString('comp user plan') })
await client.connect()

const users = await client.query('select id, email, created_at from auth.users where lower(email) = lower($1)', [email])
if (!users.rows.length) {
  console.error(`No account for ${email}. Nothing was changed.`)
  await client.end()
  process.exit(1)
}
const user = users.rows[0]

async function show(label) {
  const subs = await client.query(
    `select tier, status, current_period_end, cancel_at_period_end, polar_subscription_id, created_at
     from subscriptions where user_id = $1 order by created_at desc`, [user.id])
  const albums = await client.query('select count(*)::int n from albums where user_id = $1', [user.id])
  console.log(`\n=== ${label} ===`)
  console.log(`${user.email}  joined ${new Date(user.created_at).toISOString().slice(0, 10)}  ${albums.rows[0].n} albums`)
  if (!subs.rows.length) { console.log('  no subscription rows, so this account is free'); return subs.rows }
  for (const s of subs.rows) {
    const ours = s.polar_subscription_id.startsWith(COMP_SUBSCRIPTION_PREFIX) ? '  [comped by this script]' : ''
    // toISOString, not String(). pg returns a Date, and String(date).slice(0, 10) yields
    // "Fri Sep 10" — the YEAR falls off the end. A grant running to 2027 printed identically to one
    // expiring today, on the line whose whole job is telling you when the gift ends.
    const ends = s.current_period_end ? new Date(s.current_period_end).toISOString().slice(0, 10) : 'never'
    console.log(`  ${s.tier.padEnd(7)} ${s.status.padEnd(9)} ends ${ends}  ${s.polar_subscription_id}${ours}`)
  }
  return subs.rows
}

const before = await show('BEFORE')

if (!tier && !clearing) {
  console.log('\nNothing changed. Pass --pro or --max to grant, or --clear to remove.')
  await client.end()
  process.exit(0)
}

if (clearing) {
  const del = await client.query(
    `delete from subscriptions where user_id = $1 and polar_subscription_id like $2`,
    [user.id, `${COMP_SUBSCRIPTION_PREFIX}%`])
  console.log(`\nRemoved ${del.rowCount} comped row(s). Real Polar rows were not touched.`)
  await show('AFTER')
  await client.end()
  process.exit(0)
}

// A REAL SUBSCRIPTION ALREADY COVERS THEM. Granting on top is not harmful — the highest active tier
// wins — but it is almost always a mistake to make silently, because the person is already paying.
const RANK = { free: 0, pro: 1, studio: 2 }
const paying = before.filter((s) => !s.polar_subscription_id.startsWith(COMP_SUBSCRIPTION_PREFIX) && s.status === 'active')
if (paying.length && !flags.has('--on-top')) {
  console.error(`\n${user.email} already has a REAL active subscription (${paying.map((s) => s.tier).join(', ')}).`)
  console.error('Refusing, so a paying customer is not quietly given something they are buying.')
  console.error('If you mean to give them the tier ABOVE the one they pay for, pass --on-top.')
  await client.end()
  process.exit(2)
}
if (paying.length) {
  // --on-top IS ONLY FOR GOING UP. computeUserTier takes the highest ACTIVE tier across every row,
  // so comping at or below what they already buy changes nothing at all and only leaves a confusing
  // row behind. Worse, it reads in the database like a gift that was given, so a later reader
  // concludes they got something they did not.
  const highestPaid = Math.max(...paying.map((s) => RANK[s.tier] ?? 0))
  if (RANK[tier] <= highestPaid) {
    console.error(`\nThey already pay for ${paying.map((s) => s.tier).join(', ')}, so comping ${tier} would change nothing.`)
    console.error('--on-top is for giving somebody the tier ABOVE the one they are buying.')
    await client.end()
    process.exit(2)
  }
  console.log(`\nON TOP OF A PAID SUBSCRIPTION. They keep paying for ${paying.map((s) => s.tier).join(', ')};`)
  console.log(`this adds ${tier} alongside it, so their billing is untouched and the higher tier wins.`)
}

const mine = before.filter((s) => s.polar_subscription_id.startsWith(COMP_SUBSCRIPTION_PREFIX) && s.tier === tier)
const current = mine.length && mine[0].current_period_end ? new Date(mine[0].current_period_end) : null
const now = new Date()
const endsAt = usingMonths
  ? extendExpiryMonths(current, amount, now)
  : extendExpiry(current, amount, now)

if (mine.length) {
  // Targeted by polar_subscription_id, which the SELECT above does return. An earlier version of
  // this also fired an UPDATE keyed on `id`, a column that select never asked for — so the value
  // was undefined, the parameter went in as null, and the statement matched nothing. It would have
  // been silent: the second UPDATE did the real work and the log said "extended" either way.
  const { rowCount } = await client.query(
    `update subscriptions set current_period_end = $1, status = 'active', cancel_at_period_end = false,
     updated_at = now() where user_id = $2 and polar_subscription_id = $3`,
    [endsAt.toISOString(), user.id, mine[0].polar_subscription_id])
  if (rowCount !== 1) {
    console.error(`Expected to update exactly one row, updated ${rowCount}. Nothing is guaranteed here, check by hand.`)
    await client.end()
    process.exit(1)
  }
  console.log(`\nExtended their comped ${tier} to ${endsAt.toISOString().slice(0, 10)}.`)
} else {
  await client.query(
    `insert into subscriptions
      (id, user_id, polar_subscription_id, polar_customer_id, polar_product_id, tier, status,
       current_period_end, cancel_at_period_end)
     values ($1, $2, $3, '', $6, $4, 'active', $5, false)`,
    [randomUUID(), user.id, `${COMP_SUBSCRIPTION_PREFIX}${randomUUID()}`, tier, endsAt.toISOString(), COMP_PRODUCT_ID])
  console.log(`\nGranted ${tier} to ${user.email} until ${endsAt.toISOString().slice(0, 10)}.`)
}

await show('AFTER')
console.log('\nThis follows the ACCOUNT, so it covers albums they have not made yet.')
await client.end()
