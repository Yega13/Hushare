import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { refuseBelowTier } from '@/lib/require-tier'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { queueAlbumSettingsBroadcast } from '@/lib/broadcast'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; reveal_at?: unknown } | null
  const { slug, reveal_at } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  let revealAt: string | null = null
  if (typeof reveal_at === 'string' && reveal_at.trim().length > 0) {
    const parsed = new Date(reveal_at)
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'Invalid date format for reveal_at' }, { status: 400, headers: NO_STORE })
    }
    // Reject past dates — a reveal_at in the past would make the album appear immediately
    // revealed, defeating the purpose of a timed lock.
    if (parsed.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: 'reveal_at must be a future date' }, { status: 400, headers: NO_STORE })
    }
    if (parsed.getFullYear() > 2100) {
      return NextResponse.json({ error: 'reveal_at is too far in the future' }, { status: 400, headers: NO_STORE })
    }
    revealAt = parsed.toISOString()
  } else if (reveal_at !== null && reveal_at !== undefined) {
    return NextResponse.json({ error: 'reveal_at must be an ISO date string or null' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  // The countdown reveal is a paid feature — checked against the ALBUM OWNER'S plan, never the
  // caller's. Owner links are shareable, so asking about whoever is holding one would let a
  // single subscriber mint this on albums belonging to strangers.
  const refusal = await refuseBelowTier(access.album.user_id, 'pro', 'The countdown reveal')
  if (refusal) return refusal

  const admin = createAdminClient()
  const { error } = await admin.from('albums').update({ reveal_at: revealAt }).eq('id', access.album.id)
  if (error) {
    console.error('[album/reveal] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update reveal date' }, { status: 500, headers: NO_STORE })
  }

  queueAlbumSettingsBroadcast(access.album.id, { reveal_at: revealAt })
  return NextResponse.json({ ok: true, reveal_at: revealAt }, { headers: NO_STORE })
}
