import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { resolveAlbum } from '@/lib/server/album-access'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Thin wrapper over the shared resolveAlbum() (src/lib/server/album-access.ts), which is also
// used by the server-rendered album page so the two can never make different gating decisions.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug') ?? ''
  // owner=1 only when the client is actually in owner view (the #owner= management link is in the
  // URL this load) — a leftover owner cookie on the plain guest URL must not bypass the gates.
  const wantsOwner = url.searchParams.get('owner') === '1'

  // failOpen:true — album/resolve is read-only; failing closed would 429 all album views during a
  // rate-limit store outage. Limit is high because at an event dozens–hundreds of guests share ONE
  // venue-WiFi public IP — 900/min throttles a scraper but never a real crowd.
  const rl = await checkRateLimit(clientIpKey(req, 'album_resolve'), 60, 900, { failOpen: true })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const cookieStore = await cookies()
  const result = await resolveAlbum(slug, wantsOwner, cookieStore)

  switch (result.kind) {
    case 'invalid':
      return NextResponse.json({ error: 'Invalid slug' }, { status: 400, headers: NO_STORE })
    case 'notfound':
      return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
    case 'reveal':
      return NextResponse.json(
        { reveal_at: result.reveal_at, locked: true, slug: result.slug, title: result.title },
        { headers: NO_STORE },
      )
    case 'password':
      return NextResponse.json(
        { password_required: true, slug: result.slug, title: result.title },
        { headers: NO_STORE },
      )
    case 'album':
      return NextResponse.json(result.album, { headers: NO_STORE })
  }
}
