// Mark an album as a COLLABORATION album: the Hushare mark can no longer be hidden on it.
//
// Collaboration albums are given a Max plan for free in exchange for the album carrying our name
// in front of everyone who opens it. Max includes "remove Hushare branding" — one toggle — so
// without this the thing we are being paid in can be switched off, by accident or otherwise, and
// nobody finds out until after the event when the audience has already been and gone.
//
// This is deliberately a script and not a control on the album, because it is not the owner's
// setting to change. Enforced in api/album/branding (refuses to hide) and in resolveAlbum (forces
// the mark back on at read time, so a value stored before the lock cannot keep taking effect).
//
// USAGE
//   node scripts/collab-album.mjs <slug>            show the album's current state
//   node scripts/collab-album.mjs <slug> --lock     keep the Hushare mark on, permanently
//   node scripts/collab-album.mjs <slug> --unlock   hand the setting back to the owner
//
// <slug> accepts either the random slug or a custom URL (hushare.space/anna-and-david -> anna-and-david).

import pg from 'pg'
import { connectionString } from './db-connection.mjs'

const [, , rawSlug, flag] = process.argv
if (!rawSlug) {
  console.error('usage: node scripts/collab-album.mjs <slug> [--lock|--unlock]')
  process.exit(1)
}
if (flag && flag !== '--lock' && flag !== '--unlock') {
  console.error(`unknown option ${flag} — expected --lock or --unlock`)
  process.exit(1)
}
const slug = rawSlug.replace(/^https?:\/\/[^/]+\//, '').replace(/\/+$/, '').trim()

const client = new pg.Client({
  connectionString: connectionString('collab-album'),
  ssl: { rejectUnauthorized: false },
})
await client.connect()

// Matched on either slug, because whoever hands over an album name will send whichever one they
// see in their address bar.
const { rows } = await client.query(
  `select a.id, a.slug, a.custom_slug, a.title, a.hide_branding, a.branding_locked, a.user_id,
          coalesce((select s.tier from public.subscriptions s
                     where s.user_id = a.user_id and s.status = 'active' limit 1), 'free') as owner_tier
     from public.albums a
    where a.slug = $1 or a.custom_slug = $1`,
  [slug],
)

if (rows.length === 0) {
  console.error(`No album with slug or custom URL "${slug}".`)
  await client.end()
  process.exit(1)
}

const album = rows[0]
const describe = (a) => {
  console.log(`  album        ${a.title}`)
  console.log(`  slug         ${a.slug}${a.custom_slug ? `  (also /${a.custom_slug})` : ''}`)
  console.log(`  owner plan   ${a.owner_tier}${a.user_id ? '' : '  (guest album — no account)'}`)
  console.log(`  mark hidden  ${a.hide_branding}`)
  console.log(`  locked on    ${a.branding_locked}`)
}

if (!flag) {
  console.log('Current state:')
  describe(album)
  console.log('\nPass --lock to keep the Hushare mark on this album permanently.')
  await client.end()
  process.exit(0)
}

const lock = flag === '--lock'

// Locking also CLEARS hide_branding rather than only forbidding future changes. resolveAlbum
// already forces the mark back on for a locked album, so leaving a stale `true` in the column would
// change nothing visible — but it would sit there waiting to take effect the moment the lock came
// off, which is a trap for whoever unlocks it later.
const { rows: updated } = await client.query(
  `update public.albums
      set branding_locked = $2,
          hide_branding = case when $2 then false else hide_branding end
    where id = $1
    returning slug, custom_slug, title, hide_branding, branding_locked, user_id,
              coalesce((select s.tier from public.subscriptions s
                         where s.user_id = albums.user_id and s.status = 'active' limit 1), 'free') as owner_tier`,
  [album.id, lock],
)

console.log(lock ? 'Locked. The Hushare mark stays on this album:' : 'Unlocked. The owner controls the mark again:')
describe(updated[0])

if (lock && updated[0].owner_tier === 'free') {
  // Reads the subscriptions table only, so an account whose access comes from ADMIN_EMAILS shows
  // as 'free' here even though computeUserTier calls it studio. Worded to report what was actually
  // checked rather than to assert a plan it never looked up.
  console.log('\nNote: no active paid SUBSCRIPTION on this owner. If this is the collaboration')
  console.log('album, grant Max first — until then the mark was never removable and the lock is')
  console.log('doing nothing yet. (An admin account also shows as free here; that is expected.)')
}

await client.end()
