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

// PRESENCE AND ALBUM PHOTOS ARE COUNTED AT THE EDGE since 2026-09-14 (lib/server/edge-rate-limit), so
// their numbers are read from the module that holds them -- not parsed out of a route that no longer
// calls checkRateLimit. tests/edge-rate-limit-config holds the module equal to wrangler.toml and proves
// each route asks its own limit, so this arithmetic is about the numbers that actually run.
const { READ_LIMITS, READ_LIMIT_PERIOD_SECONDS } = await import('@/lib/server/edge-rate-limit')
const edgeLimit = (name: keyof typeof READ_LIMITS) => ({ windowSeconds: READ_LIMIT_PERIOD_SECONDS, max: READ_LIMITS[name].perMinute })

// HOW MANY REQUESTS ONE REFRESH IS, counted by RUNNING the refresh (rule 17) the way it runs during an
// upload stream: the viewer knows what it holds and every check finds a few new photos. This was assumed
// to be one while the code made two -- a probe and then a fetch -- which put a real venue past the limit
// at about 420 guests instead of the 800 the arithmetic promised (review of 2026-09-14).
const { refreshAlbum } = await import('@/lib/album-refresh')
async function requestsPerBusyRefresh(): Promise<number> {
  let requests = 0
  let seen = { total: 100, latest: '2026-09-19T08:00:00Z' }
  const newRows = [1, 2, 3].map((i) => ({ id: `n${i}`, created_at: '2026-09-19T08:00:05Z' }))
  await refreshAlbum({
    seen: () => seen,
    remember: (f) => { seen = { total: f.total, latest: f.latest ?? seen.latest } },
    probe: async () => { requests++; return { total: 103, latest: '2026-09-19T08:00:05Z' } },
    since: async () => { requests++; return { photos: newRows, total: 103, latest: '2026-09-19T08:00:05Z' } },
    window: async () => { requests++; return { photos: newRows, total: 103 } },
    applyDelta: () => {},
    applyWindow: () => {},
    maxDelta: 100,
  }, { force: false })
  return requests
}

describe('rate limits fit a real event, not just one visitor', () => {
  it('presence: every guest pings, and they all share one venue IP', () => {
    const beacon = source('components/PresenceBeacon.tsx')
    const interval = /setInterval\(ping, (\d[\d_]*)\)/.exec(beacon)
    expect(interval, 'PresenceBeacon must ping on an interval').not.toBeNull()
    const everyMs = Number((interval as RegExpExecArray)[1].replace(/_/g, ''))
    // A presence row is pruned after ten minutes, so pinging much faster than that buys nothing.
    expect(everyMs, 'pinging more than once a minute costs requests for data kept 10 minutes').toBeGreaterThanOrEqual(60_000)

    const { windowSeconds, max } = edgeLimit('presence')
    const needed = GUESTS * (windowSeconds / (everyMs / 1000))
    expect(max, `${GUESTS} guests need ${Math.ceil(needed)} per ${windowSeconds}s`).toBeGreaterThanOrEqual(needed * HEADROOM)
  })

  it('album photos: every guest refetches on the debounce during an upload burst', async () => {
    const client = source('app/[slug]/AlbumPageClient.tsx')
    const debounce = /const REFETCH_DEBOUNCE_MS = (\d[\d_]*)/.exec(client)
    expect(debounce, 'the refetch debounce must be a named constant').not.toBeNull()
    const everyMs = Number((debounce as RegExpExecArray)[1].replace(/_/g, ''))

    const { windowSeconds, max } = edgeLimit('albumPhotos')
    const perRefresh = await requestsPerBusyRefresh()
    expect(perRefresh, 'a refresh that finds new photos must be ONE request').toBe(1)
    const needed = GUESTS * (windowSeconds / (everyMs / 1000)) * perRefresh
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
