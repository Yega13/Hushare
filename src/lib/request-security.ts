import { NextResponse } from 'next/server'

// staging is here because the CSRF check now covers /api/auth/confirm: without it, signing in on
// staging 403s and the environment cannot be tested at all. It is our own host, on the same
// deployment, and being absent from this list was already breaking every other mutating route
// there — the login was just the first one anybody would notice.
const ALLOWED_ORIGIN_HOSTS = new Set(['hushare.space', 'www.hushare.space', 'staging.hushare.space'])
const ALLOWED_LOCAL_PORTS = new Set(['3000', '3001', '5173', '8000', '8080'])
const IS_DEV = process.env.NODE_ENV !== 'production'

// Rejects cross-site state-mutating requests.
// For POST/PUT/PATCH/DELETE: requires a valid Origin header (rejects if absent).
// For GET: allows missing Origin (browser navigations, fetch without Origin, etc.).
export function forbidCrossSiteRequest(req: Request) {
  const method = req.method?.toUpperCase()
  const origin = req.headers.get('origin')

  // Require Origin on all mutating requests — curl and server-side callers without Origin are blocked
  if (!origin) {
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null
    return forbidden()
  }

  // RFC 6454 §7.3: browsers set Origin to the literal string "null" for sandboxed iframes,
  // data: URIs, and some privacy modes. Never allow the null origin for mutations.
  if (origin === 'null') return forbidden()

  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return forbidden()
  }

  if (ALLOWED_ORIGIN_HOSTS.has(url.host)) return null

  // Localhost only allowed outside production — prevents DNS rebinding attacks in prod.
  // url.hostname for http://[::1]:3000 is '::1' (URL strips the brackets).
  if (
    IS_DEV &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') &&
    ALLOWED_LOCAL_PORTS.has(url.port)
  ) return null

  return forbidden()
}

function forbidden() {
  return NextResponse.json(
    { error: 'Forbidden' },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  )
}
