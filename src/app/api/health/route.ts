import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

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
