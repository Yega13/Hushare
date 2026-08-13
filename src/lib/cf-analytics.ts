import 'server-only'

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
export type TrafficAnalytics = {
  configured: boolean
  workerMetrics: WorkerMetrics
  eventTotals: EventTotal[]
  topAlbums: TopAlbum[]
  viewsPerDay: DayPoint[]
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

export async function getTrafficAnalytics(): Promise<TrafficAnalytics> {
  const c = creds()
  if (!c) return { configured: false, workerMetrics: null, eventTotals: [], topAlbums: [], viewsPerDay: [], errors: [] }
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
  const [totalsRes, topRes, viewsRes] = await Promise.all([
    aeSql(c.accountId, c.token, `SELECT blob1 AS event, sum(_sample_interval) AS n FROM Hushare_events WHERE timestamp > NOW() - INTERVAL '7' DAY GROUP BY event ORDER BY n DESC`),
    aeSql(c.accountId, c.token, `SELECT blob2 AS album, sum(_sample_interval) AS views FROM Hushare_events WHERE blob1 = 'album_viewed' AND blob2 != '' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY album ORDER BY views DESC LIMIT 12`),
    aeSql(c.accountId, c.token, `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, sum(_sample_interval) AS views FROM Hushare_events WHERE blob1 = 'album_viewed' AND timestamp > NOW() - INTERVAL '14' DAY GROUP BY day ORDER BY day`),
  ])
  if (totalsRes.error) errors.push('events: ' + totalsRes.error)
  if (topRes.error) errors.push('topAlbums: ' + topRes.error)
  if (viewsRes.error) errors.push('views/day: ' + viewsRes.error)

  const eventTotals = totalsRes.rows.map((r) => ({ event: String(r.event ?? ''), count: num(r.n) })).filter((e) => e.event)
  const topAlbums = topRes.rows.map((r) => ({ albumId: String(r.album ?? ''), views: num(r.views) })).filter((a) => a.albumId)
  const viewsPerDay = viewsRes.rows.map((r) => ({ day: String(r.day ?? '').slice(0, 10), value: num(r.views) }))

  return { configured: true, workerMetrics, eventTotals, topAlbums, viewsPerDay, errors }
}
