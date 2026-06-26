import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteAlbumAssetsAndRows } from '@/lib/album-delete'
import { getUserTierById } from '@/lib/subscriptions'
import { timingSafeEqual } from '@/lib/timing-safe'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const RETIRE_AFTER_DAYS = 365
const BATCH_SIZE = 25

type RetirementCandidate = {
  id: string
  slug: string
  user_id: string | null
  background_theme: string | null
  last_activity_at: string
}

export async function POST(req: Request) {
  // Fail-closed: a missing secret in production means anyone could trigger
  // mass deletion of inactive free albums. Refuse to run unless set.
  const secret = process.env.ALBUM_RETIREMENT_SECRET
  if (!secret) {
    console.error('[retire-albums] ALBUM_RETIREMENT_SECRET not set; refusing to run')
    return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
  }
  if (secret.length < 32) {
    console.error('[retire-albums] ALBUM_RETIREMENT_SECRET must be at least 32 characters')
    return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
  }
  const auth = req.headers.get('authorization') ?? ''
  if (!timingSafeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const cutoff = new Date(Date.now() - RETIRE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const admin = createAdminClient()
  const { data: candidates, error } = await admin
    .from('albums')
    .select('id, slug, user_id, background_theme, last_activity_at')
    .is('retired_at', null)
    .lt('last_activity_at', cutoff)
    .order('last_activity_at', { ascending: true })
    .limit(BATCH_SIZE)
    .returns<RetirementCandidate[]>()

  if (error) {
    console.error('[retire-albums] candidate lookup failed:', error.message)
    return NextResponse.json({ error: 'Could not scan albums' }, { status: 500, headers: NO_STORE })
  }

  let retired = 0
  let skippedPaid = 0
  let failed = 0

  for (const album of candidates ?? []) {
    let tier: Awaited<ReturnType<typeof getUserTierById>>
    try {
      tier = await getUserTierById(album.user_id)
    } catch (err) {
      // If tier check fails for any reason, skip — never delete on uncertainty.
      console.error('[retire-albums] tier check failed for album', album.slug, ':', err instanceof Error ? err.message : String(err))
      failed += 1
      continue
    }

    if (tier !== 'free') {
      skippedPaid += 1
      // Reset activity so it doesn't show up in the next scan.
      await admin.from('albums').update({ last_activity_at: new Date().toISOString() }).eq('id', album.id)
      continue
    }

    // Mark retired atomically — if another cron run already claimed this album, skip it.
    const { count: claimCount } = await admin
      .from('albums')
      .update({ retired_at: new Date().toISOString() }, { count: 'exact' })
      .eq('id', album.id)
      .is('retired_at', null)
    if (!claimCount) continue

    const result = await deleteAlbumAssetsAndRows(admin, album)
    if (result.ok) {
      retired += 1
    } else {
      // Deletion failed — clear retired_at so the next cron run can retry.
      console.error('[retire-albums] deletion failed for album', album.slug, '— resetting retired_at for retry')
      await admin.from('albums').update({ retired_at: null }).eq('id', album.id)
      failed += 1
    }
  }

  return NextResponse.json(
    { ok: true, scanned: candidates?.length ?? 0, retired, skippedPaid, failed, cutoff },
    { headers: NO_STORE },
  )
}
