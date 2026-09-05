import { NextResponse } from 'next/server'
import { refuseRateLimited } from '@/lib/server/respond'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { canRestore } from '@/lib/album-bin'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const SLUG_RE = /^[a-z0-9-]{1,64}$/
const MAX_SLUGS = 60

// Which of these albums still exist? "Your albums on this device" is rebuilt from localStorage,
// which has no idea an album was deleted somewhere else — from the owner toolbar, on another
// device, or by the retention job. Those entries lingered as ghosts the owner could not get rid
// of: tapping Delete on an already-deleted album is a no-op, so the list only ever grew.
//
// Also reports which of them have no account behind them (`unclaimed`), so "Your albums on this
// device" can offer to attach those to a signed-in visitor's account. An album made while signed
// out is invisible in BOTH places for a signed-in person — it is not on their profile, and this
// list used to hide itself from them entirely — which is how 40 albums holding photos ended up
// stranded and a customer had to email support to find one.
//
// Discloses nothing new: anyone can already tell a slug exists by requesting the album URL and
// seeing 200 vs 404. Returns ONLY the subset asked about, so it cannot be used to enumerate, and
// knowing an album is unclaimed grants nothing on its own — claiming still requires the owner
// token, which only the creator's own device holds.
export async function POST(req: Request) {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  // failOpen: a limiter blip must not make the list prune everything it can't verify.
  const rl = await checkRateLimit(clientIpKey(req, 'album_exists'), 60, 30, { failOpen: true })
  if (!rl.ok) return refuseRateLimited(rl, 'Too many requests')

  const body = await req.json().catch(() => null) as { slugs?: unknown } | null
  const raw = Array.isArray(body?.slugs) ? body.slugs : []
  const slugs = raw
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => SLUG_RE.test(s))
    .slice(0, MAX_SLUGS)

  if (slugs.length === 0) return NextResponse.json({ alive: [] }, { headers: NO_STORE })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('albums')
    // NO retired_at FILTER ANY MORE, and that matters more than it looks.
    //
    // An album the owner deleted is hidden by retired_at, so it stopped being "alive" — and this
    // list PRUNES anything not alive, which calls forgetAlbum() and throws away the owner token.
    // That token is the only key to an anonymous album, and 71 of the 105 live albums are
    // anonymous. So deleting one used to discard, within seconds, the only thing that could ever
    // bring it back. The rows are classified below instead of being filtered away here.
    .select('slug, custom_slug, user_id, retired_at, deleted_at')
    .or(`slug.in.(${slugs.join(',')}),custom_slug.in.(${slugs.join(',')})`)
    .returns<{ slug: string; custom_slug: string | null; user_id: string | null; retired_at: string | null; deleted_at: string | null }[]>()

  if (error) {
    // On failure report everything as alive. Pruning on an error would delete the owner's only
    // record of a live album — losing the token for good.
    console.error('[album/exists] lookup failed:', error.message)
    // Report everything alive AND nothing unclaimed: the first keeps a live album's token, the
    // second offers no action we could not verify. Both err toward doing nothing (rule 19).
    return NextResponse.json({ alive: slugs, unclaimed: [], binned: [] }, { headers: NO_STORE })
  }

  const found = new Set<string>()
  const unowned = new Set<string>()
  const inBin = new Set<string>()
  const both = (row: { slug: string; custom_slug: string | null }, set: Set<string>) => {
    if (row.slug) set.add(row.slug)
    if (row.custom_slug) set.add(row.custom_slug)
  }
  for (const row of data ?? []) {
    // DELETED BUT RECOVERABLE is its own answer. Not alive — the album really is hidden from
    // everyone — but the device must keep its token, because that token is what the restore route
    // authenticates with. An album retired for INACTIVITY is neither: it is genuinely gone, and
    // pruning it is right.
    if (row.deleted_at && canRestore(row.deleted_at, Date.now())) {
      both(row, inBin)
      continue
    }
    if (row.retired_at) continue
    both(row, found)
    if (row.user_id === null) both(row, unowned)
  }
  return NextResponse.json({
    alive: slugs.filter((s) => found.has(s)),
    unclaimed: slugs.filter((s) => unowned.has(s)),
    binned: slugs.filter((s) => inBin.has(s)),
  }, { headers: NO_STORE })
}
