import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// EVERY PER-IP LIMIT IN THIS PRODUCT IS FIGHTING ITS OWN USE CASE.
//
// The whole point of Hushare is a lot of people at one venue. They are all on the venue WiFi, so
// cf-connecting-ip gives every one of them the SAME public IP and they share ONE bucket. A ceiling
// picked for "one abusive client" therefore refuses a real room, and the failure is invisible from
// a desk: it only appears when 300 people are in front of you.
//
// This was not hypothetical. Measured on 2026-08-28 against a 300-guest event:
//   presence      600/min needed (ping every 30s), ceiling 120   — four fifths refused
//   album photos  7200/min at peak (refetch every 2.5s), ceiling 6000
//   engagement    ~900/hour, ceiling 400
//
// So the arithmetic lives here, in a test, instead of in someone's head. If a ceiling is lowered
// or a beacon is made chattier, this fails and says which event size it stops fitting.
const GUESTS = 300          // the scenario the product is sold for
const HEADROOM = 1.5        // and it must not be sized exactly to the edge

function source(rel: string): string {
  return readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8')
}

/** Pull the (window, max) pair out of a checkRateLimit call identified by its key prefix. */
function limitFor(rel: string, key: string): { windowSeconds: number; max: number } {
  const s = source(rel)
  const m = new RegExp(`checkRateLimit\\(\\s*clientIpKey\\(req, '${key}'\\)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)`).exec(s)
  if (!m) throw new Error(`no checkRateLimit for '${key}' in ${rel}`)
  return { windowSeconds: Number(m[1]), max: Number(m[2]) }
}

describe('rate limits fit a real event, not just one visitor', () => {
  it('presence: every guest pings, and they all share one venue IP', () => {
    const beacon = source('components/PresenceBeacon.tsx')
    const interval = /setInterval\(ping, (\d[\d_]*)\)/.exec(beacon)
    expect(interval, 'PresenceBeacon must ping on an interval').not.toBeNull()
    const everyMs = Number((interval as RegExpExecArray)[1].replace(/_/g, ''))
    // A presence row is pruned after ten minutes, so pinging much faster than that buys nothing.
    expect(everyMs, 'pinging more than once a minute costs requests for data kept 10 minutes').toBeGreaterThanOrEqual(60_000)

    const { windowSeconds, max } = limitFor('app/api/presence/route.ts', 'presence')
    const needed = GUESTS * (windowSeconds / (everyMs / 1000))
    expect(max, `${GUESTS} guests need ${Math.ceil(needed)} per ${windowSeconds}s`).toBeGreaterThanOrEqual(needed * HEADROOM)
  })

  it('album photos: every guest refetches on the debounce during an upload burst', () => {
    const client = source('app/[slug]/AlbumPageClient.tsx')
    const debounce = /const REFETCH_DEBOUNCE_MS = (\d[\d_]*)/.exec(client)
    expect(debounce, 'the refetch debounce must be a named constant').not.toBeNull()
    const everyMs = Number((debounce as RegExpExecArray)[1].replace(/_/g, ''))

    const { windowSeconds, max } = limitFor('app/api/album/photos/route.ts', 'album_photos')
    const needed = GUESTS * (windowSeconds / (everyMs / 1000))
    // Being refused here is the worst of the three: the album stops updating during the event it
    // was made for, which is the one moment it exists to serve.
    expect(max, `${GUESTS} guests refetching every ${everyMs}ms need ${Math.ceil(needed)} per ${windowSeconds}s`)
      .toBeGreaterThanOrEqual(needed * HEADROOM)
  })

  it('engagement: one beacon per page view, several pages per guest', () => {
    const { windowSeconds, max } = limitFor('app/api/log/engagement/route.ts', 'engagement')
    expect(windowSeconds).toBe(3600)
    // Three page views an hour per guest is ordinary: arrive, open a photo, come back later.
    const needed = GUESTS * 3
    expect(max, `${GUESTS} guests viewing 3 pages need ${needed}/hour`).toBeGreaterThanOrEqual(needed * HEADROOM)
  })
})
