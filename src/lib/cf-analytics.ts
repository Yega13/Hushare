import 'server-only'
import { countryName } from '@/lib/country-names'

// Read-only Cloudflare analytics for the admin dashboard. Two sources, both authed with the
// CLOUDFLARE_ANALYTICS_TOKEN secret (Account · Account Analytics · Read):
//   1. GraphQL Analytics API  → worker requests / errors / CPU-time percentiles.
//   2. Analytics Engine SQL   → our own product events (album_viewed, media_uploaded, …).
// getTrafficAnalytics() runs everything, never throws, and returns any per-query error string so the
// admin page can show exactly what worked — a telemetry hiccup can never break the page.

const GQL_URL = 'https://api.cloudflare.com/client/v4/graphql'

function creds(): { accountId: string; token: string } | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_ANALYTICS_TOKEN
  if (!accountId || !token) return null
  return { accountId, token }
}

export type WorkerMetrics = { requests: number; errors: number; cpuP50: number; cpuP99: number } | null
export type EventTotal = { event: string; count: number }
export type TopAlbum = { albumId: string; views: number }
export type DayPoint = { day: string; value: number }
// Who the visitors are — aggregate only, and deliberately so. Every row here describes a group
// ("Yerevan, Sunday 21:00, from Instagram, on a phone"), never a person: no identifier is collected
// that survives a page load, so there is nothing to follow anyone with. See visitor-context.ts.
export type Breakdown = { label: string; count: number; cc?: string }
/** Views by visitor-LOCAL hour and weekday. hour 0-23, weekday 0=Sun. */
export type ClockPoint = { weekday: number; hour: number; count: number }
/** One step of the upload path, as a count of FILES. */
export type FunnelStep = { step: string; files: number }
/** Median upload throughput in KB/s, from finished batches. */
export type Throughput = { medianKbps: number; batches: number }
/** How long a page held people, and how far down they got. */
export type PageEngagement = { page: string; views: number; medianDwell: number; avgScroll: number; activePct: number }
export type TrafficAnalytics = {
  configured: boolean
  workerMetrics: WorkerMetrics
  eventTotals: EventTotal[]
  topAlbums: TopAlbum[]
  viewsPerDay: DayPoint[]
  countries: Breakdown[]
  cities: Breakdown[]
  referrers: Breakdown[]
  devices: Breakdown[]
  clock: ClockPoint[]
  funnel: FunnelStep[]
  throughput: Throughput
  engagement: PageEngagement[]
  friction: Breakdown[]
  errors: string[]
}

const num = (v: unknown): number => {
  const x = Math.round(Number(v ?? 0))
  return Number.isFinite(x) ? x : 0
}

// Analytics Engine SQL — returns rows + a human-readable error (never throws). NOTE the sampling
// column is `_sample_interval` (summing it gives sampling-corrected true counts).
async function aeSql(accountId: string, token: string, sql: string): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: sql, cache: 'no-store',
    })
    if (!r.ok) {
      const body = (await r.text().catch(() => '')).slice(0, 180)
      return { rows: [], error: `${r.status} ${body}` }
    }
    const j = (await r.json()) as { data?: Record<string, unknown>[] }
    return { rows: j.data ?? [], error: null }
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) }
  }
}

// One row per page from a (page, active, dwell) histogram.
//
// The median is computed here, from weights, rather than asked of the database: quantileWeighted is
// the same bet that CONCAT lost, and losing it again would silently blank a panel. A weighted median
// over at most a few thousand buckets is nothing to do in JS, and it is exact.
// Weighted median of upload throughput. A mean would be dominated by whoever has fibre.
function foldThroughput(rows: Record<string, unknown>[]): Throughput {
  const buckets = rows
    .map((r) => ({ kbps: Math.round(Number(r.kbps ?? 0)), n: Math.round(Number(r.n ?? 0)) }))
    .filter((b) => b.kbps > 0 && b.n > 0)
    .sort((a, b) => a.kbps - b.kbps)
  const total = buckets.reduce((sum, b) => sum + b.n, 0)
  if (total === 0) return { medianKbps: 0, batches: 0 }
  let seen = 0
  for (const b of buckets) {
    seen += b.n
    if (seen >= total / 2) return { medianKbps: b.kbps, batches: total }
  }
  return { medianKbps: 0, batches: total }
}

function foldEngagement(rows: Record<string, unknown>[]): PageEngagement[] {
  const byPage = new Map<string, { views: number; active: number; scrollW: number; dwells: { d: number; n: number }[] }>()
  for (const r of rows) {
    const page = String(r.page ?? '')
    if (!page) continue
    const n = Math.round(Number(r.n ?? 0)) || 0
    if (n <= 0) continue
    const entry = byPage.get(page) ?? { views: 0, active: 0, scrollW: 0, dwells: [] }
    entry.views += n
    if (String(r.act ?? '') === 'active') entry.active += n
    entry.scrollW += Number(r.scrollw ?? 0)
    entry.dwells.push({ d: Math.round(Number(r.dwell ?? 0)) || 0, n })
    byPage.set(page, entry)
  }

  return [...byPage.entries()]
    .map(([page, e]) => {
      e.dwells.sort((a, b) => a.d - b.d)
      const half = e.views / 2
      let seen = 0
      let median = 0
      for (const bucket of e.dwells) {
        seen += bucket.n
        if (seen >= half) { median = bucket.d; break }
      }
      return {
        page,
        views: e.views,
        medianDwell: median,
        avgScroll: e.views > 0 ? Math.round(e.scrollW / e.views) : 0,
        activePct: e.views > 0 ? Math.round((e.active / e.views) * 100) : 0,
      }
    })
    .sort((a, b) => b.views - a.views)
    .slice(0, 12)
}

export async function getTrafficAnalytics(): Promise<TrafficAnalytics> {
  const c = creds()
  if (!c) return { configured: false, workerMetrics: null, eventTotals: [], topAlbums: [], viewsPerDay: [], countries: [], cities: [], referrers: [], devices: [], clock: [], funnel: [], throughput: { medianKbps: 0, batches: 0 }, engagement: [], friction: [], errors: [] }
  const errors: string[] = []

  // ── Worker metrics via GraphQL (requests / errors / CPU percentiles, last 24h) ──
  let workerMetrics: WorkerMetrics = null
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const until = new Date().toISOString()
    const query = `query($tag:String!,$since:Time!,$until:Time!){viewer{accounts(filter:{accountTag:$tag}){workersInvocationsAdaptive(limit:100,filter:{datetime_geq:$since,datetime_leq:$until,scriptName:"hushare"}){sum{requests errors}quantiles{cpuTimeP50 cpuTimeP99}}}}}`
    const r = await fetch(GQL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { tag: c.accountId, since, until } }),
      cache: 'no-store',
    })
    const j = (await r.json()) as {
      data?: { viewer?: { accounts?: { workersInvocationsAdaptive?: { sum?: { requests?: number; errors?: number }; quantiles?: { cpuTimeP50?: number; cpuTimeP99?: number } }[] }[] } }
      errors?: { message?: string }[]
    }
    if (j.errors?.length) errors.push('worker: ' + j.errors.map((e) => e.message).join('; ').slice(0, 180))
    const nodes = j?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive
    if (nodes?.length) {
      let requests = 0, errs = 0, p50 = 0, p99 = 0
      for (const nn of nodes) {
        requests += nn.sum?.requests ?? 0
        errs += nn.sum?.errors ?? 0
        p50 = Math.max(p50, nn.quantiles?.cpuTimeP50 ?? 0)
        p99 = Math.max(p99, nn.quantiles?.cpuTimeP99 ?? 0)
      }
      workerMetrics = { requests: num(requests), errors: num(errs), cpuP50: num(p50), cpuP99: num(p99) }
    }
  } catch (e) {
    errors.push('worker: ' + (e instanceof Error ? e.message : String(e)))
  }

  // ── Product events via Analytics Engine SQL ──
  // 30 days for the WHO queries rather than the 7 the counters use: geography and arrival channel
  // change slowly, and a week of a low-traffic product is too few rows to say anything. blob7-12 and
  // double3-4 are only populated on events that had a real visitor behind them, so the `!= ''`
  // filters also exclude cron and webhook rows, which have no location by definition.
  const [totalsRes, topRes, viewsRes, countryRes, cityRes, refRes, devRes, clockRes, funnelRes, thruRes, engRes, fricRes] = await Promise.all([
    aeSql(c.accountId, c.token, `SELECT blob1 AS event, sum(_sample_interval) AS n FROM Hushare_events WHERE timestamp > NOW() - INTERVAL '7' DAY GROUP BY event ORDER BY n DESC`),
    aeSql(c.accountId, c.token, `SELECT blob2 AS album, sum(_sample_interval) AS views FROM Hushare_events WHERE blob1 = 'album_viewed' AND blob2 != '' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY album ORDER BY views DESC LIMIT 12`),
    aeSql(c.accountId, c.token, `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, sum(_sample_interval) AS views FROM Hushare_events WHERE blob1 = 'album_viewed' AND timestamp > NOW() - INTERVAL '14' DAY GROUP BY day ORDER BY day`),
    aeSql(c.accountId, c.token, `SELECT blob7 AS k, sum(_sample_interval) AS n FROM Hushare_events WHERE blob1 = 'album_viewed' AND blob7 != '' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY k ORDER BY n DESC LIMIT 15`),
    aeSql(c.accountId, c.token, `SELECT blob8 AS city, blob7 AS cc, sum(_sample_interval) AS n FROM Hushare_events WHERE blob1 = 'album_viewed' AND blob8 != '' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY city, cc ORDER BY n DESC LIMIT 15`),
    aeSql(c.accountId, c.token, `SELECT blob10 AS k, sum(_sample_interval) AS n FROM Hushare_events WHERE blob1 = 'album_viewed' AND blob10 != '' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY k ORDER BY n DESC LIMIT 10`),
    aeSql(c.accountId, c.token, `SELECT blob12 AS k, sum(_sample_interval) AS n FROM Hushare_events WHERE blob1 = 'album_viewed' AND blob12 != '' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY k ORDER BY n DESC LIMIT 6`),
    aeSql(c.accountId, c.token, `SELECT double4 AS wd, double3 AS hr, sum(_sample_interval) AS n FROM Hushare_events WHERE blob1 = 'album_viewed' AND double3 >= 0 AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY wd, hr`),
    // double1 is a FILE count, so this sums files rather than beacons — "300 of 340 chosen photos
    // arrived" is the useful sentence, not "42 batches happened".
    aeSql(c.accountId, c.token, `SELECT blob6 AS step, sum(double1 * _sample_interval) AS files FROM Hushare_events WHERE blob1 = 'upload_funnel' AND blob6 != '' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY step`),
    // A weighted histogram of KB/s, folded into a median in JS — same reason the dwell median is
    // computed there: quantile functions are the bet that CONCAT already lost against this SQL
    // subset, and losing it again would silently blank the panel.
    aeSql(c.accountId, c.token, `SELECT double2 AS kbps, sum(_sample_interval) AS n FROM Hushare_events WHERE blob1 = 'upload_funnel' AND blob6 = 'done' AND double2 > 0 AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY kbps ORDER BY n DESC LIMIT 2000`),
    // MEDIAN dwell, not mean: one abandoned tab left open for twenty minutes drags an average far
    // enough to make a page look loved when nobody stayed.
    aeSql(c.accountId, c.token, `SELECT blob5 AS page, blob6 AS act, double1 AS dwell, sum(_sample_interval) AS n, sum(double2 * _sample_interval) AS scrollw FROM Hushare_events WHERE blob1 = 'page_engaged' AND blob5 != '' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY page, act, dwell ORDER BY n DESC LIMIT 4000`),
    aeSql(c.accountId, c.token, `SELECT blob5 AS page, blob6 AS detail, sum(_sample_interval) AS n FROM Hushare_events WHERE blob1 = 'friction' AND blob6 != '' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY page, detail ORDER BY n DESC LIMIT 12`),
  ])
  if (totalsRes.error) errors.push('events: ' + totalsRes.error)
  if (topRes.error) errors.push('topAlbums: ' + topRes.error)
  if (viewsRes.error) errors.push('views/day: ' + viewsRes.error)

  const eventTotals = totalsRes.rows.map((r) => ({ event: String(r.event ?? ''), count: num(r.n) })).filter((e) => e.event)
  const topAlbums = topRes.rows.map((r) => ({ albumId: String(r.album ?? ''), views: num(r.views) })).filter((a) => a.albumId)
  const viewsPerDay = viewsRes.rows.map((r) => ({ day: String(r.day ?? '').slice(0, 10), value: num(r.views) }))

  for (const [name, res] of [['countries', countryRes], ['cities', cityRes], ['referrers', refRes], ['devices', devRes], ['clock', clockRes], ['funnel', funnelRes], ['throughput', thruRes], ['engagement', engRes], ['friction', fricRes]] as const) {
    if (res.error) errors.push(`${name}: ${res.error}`)
  }
  const cities = cityRes.rows
    .map((r) => ({ label: String(r.city ?? '').trim(), count: num(r.n), cc: String(r.cc ?? '').trim() }))
    .filter((b) => b.label)
  const breakdown = (rows: Record<string, unknown>[]): Breakdown[] =>
    rows.map((r) => ({ label: String(r.k ?? '').trim(), count: num(r.n) })).filter((b) => b.label && b.label !== ',')
  const clock = clockRes.rows
    .map((r) => ({ weekday: num(r.wd), hour: num(r.hr), count: num(r.n) }))
    .filter((p) => p.hour >= 0 && p.hour <= 23 && p.weekday >= 0 && p.weekday <= 6)

  return {
    configured: true, workerMetrics, eventTotals, topAlbums, viewsPerDay,
    countries: countryRes.rows
      .map((r) => {
        const cc = String(r.k ?? '').trim()
        return { label: countryName(cc), count: num(r.n), cc }
      })
      .filter((b) => b.label),
    cities,
    referrers: breakdown(refRes.rows),
    devices: breakdown(devRes.rows),
    clock,
    // Fixed order, because a funnel that reorders itself by size is not a funnel.
    funnel: (['picked', 'started', 'done', 'failed'] as const).map((step) => ({
      step,
      files: num(funnelRes.rows.find((r) => String(r.step ?? '') === step)?.files),
    })),
    throughput: foldThroughput(thruRes.rows),
    engagement: foldEngagement(engRes.rows),
    friction: fricRes.rows
      .map((r) => ({ label: `${String(r.page ?? '')} — ${String(r.detail ?? '')}`.trim(), count: num(r.n) }))
      .filter((f) => f.label && f.label !== '—'),
    errors,
  }
}
