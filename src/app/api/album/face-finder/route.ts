import { NextResponse } from 'next/server'
import { deleteCollection } from '@/lib/rekognition'
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
    return NextResponse.json({ error: 'Face Finder requires a Max plan' }, { status: 403, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('albums').update({ face_finder_enabled: enabled }).eq('id', access.album.id)

  // Switching the feature OFF used to leave every face template in place, still enrolled and still
  // matchable — the switch stopped new photos being read and did nothing about the biometric data
  // already created. Turning it off now means what an owner reasonably assumes it means.
  if (!error && enabled === false) {
    try {
      await deleteCollection(access.album.id)
      // NULL is "never looked at", so re-enabling later re-indexes rather than trusting face ids
      // that AWS no longer holds.
      await admin.from('photos').update({ face_ids: null }).eq('album_id', access.album.id)
    } catch (e) {
      console.error('[album/face-finder] collection delete failed:', e instanceof Error ? e.message : String(e))
    }
  }
  if (error) {
    console.error('[album/face-finder] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update Face Finder' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, face_finder_enabled: enabled }, { headers: NO_STORE })
}
