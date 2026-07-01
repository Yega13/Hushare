import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { getUserTierById } from '@/lib/subscriptions'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Owner toggle for the AI Face Finder feature. Studio tier only (Rekognition costs money).
export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; enabled?: unknown } | null
  const { slug, enabled } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  // Guest album owners have no account — a subscription is required
  if (!access.userId) {
    return NextResponse.json({ error: 'Sign in to use Face Finder' }, { status: 401, headers: NO_STORE })
  }
  const tier = await getUserTierById(access.userId)
  if (tier !== 'studio') {
    return NextResponse.json({ error: 'Face Finder requires a Studio plan' }, { status: 403, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('albums').update({ face_finder_enabled: enabled }).eq('id', access.album.id)
  if (error) {
    console.error('[album/face-finder] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update Face Finder' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, face_finder_enabled: enabled }, { headers: NO_STORE })
}
