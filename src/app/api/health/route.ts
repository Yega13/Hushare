import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

// A liveness probe must not do work.
//
// Next auto-implements HEAD by running GET (node_modules/next/dist/server/route-modules/app-route/
// helpers/auto-implement-methods.js: `methods.HEAD = handlers.GET`), so without this every HEAD
// would execute the unfiltered `count: 'exact'` over `albums` below. The upload retry path polls
// this endpoint to ask "can I reach the origin at all" while a network is down (see
// originReachable in UploadZone.tsx) — and at an event, hundreds of devices behind one venue NAT
// would then aim a continuous stream of full table counts at the very database whose slowness
// caused the probing. A liveness probe that amplifies load on the resource it is probing turns a
// recoverable slowdown into an outage, so this answers from the edge of the Worker and touches
// nothing.
export function HEAD() {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET() {
  const checks = {
    supabase: false,
    r2: false,
    stream: false,
  }

  try {
    const admin = createAdminClient()
    const { error } = await admin.from('albums').select('*', { count: 'exact', head: true })
    checks.supabase = !error
  } catch {
    checks.supabase = false
  }

  checks.r2 = !!(
    process.env.CLOUDFLARE_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_PUBLIC_HOST
  )

  checks.stream = !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_STREAM_TOKEN)

  const ok = Object.values(checks).every(Boolean)
  const isProd = process.env.NODE_ENV === 'production'
  return NextResponse.json(
    // In production, omit individual check results — they reveal which credentials
    // are absent, which is information an attacker could use to probe the deployment.
    isProd ? { ok } : { ok, checks },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
