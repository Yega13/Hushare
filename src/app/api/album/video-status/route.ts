import { NextResponse } from 'next/server'
import { refuseRateLimited } from '@/lib/server/respond'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { getStreamVideoStatus } from '@/lib/cloudflare/stream'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const UID_RE = /^[0-9a-f]{32}$/

// Has Cloudflare finished encoding this video yet?
//
// A photos row is written when the BYTES land, but Stream encodes afterwards, and a large file
// takes real time -- an 849 MB ten-minute clip was 54% done eight minutes in and ready at about
// twenty. The player answers "An unknown error occurred" for the whole of that window, so the guest
// who uploaded it, and everyone else in the album, is told a perfectly good video is broken.
//
// Deliberately NOT an open proxy to the Stream API: the uid must already exist in photos, so this
// can only ever report on videos that belong to an album on this site. It returns nothing but a
// boolean and a percentage -- no playback URLs, no account information, nothing that is not already
// implied by the video being in a public album.
export async function POST(req: Request) {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  // failOpen: a limiter blip must not make a playable video look broken. The worst case of
  // answering here is one extra Stream lookup; the worst case of refusing is the bug this fixes.
  const rl = await checkRateLimit(clientIpKey(req, 'video_status'), 60, 60, { failOpen: true })
  if (!rl.ok) {
    return refuseRateLimited(rl, 'Too many requests')
  }

  const body = await req.json().catch(() => null) as { uid?: unknown } | null
  const uid = body?.uid
  if (typeof uid !== 'string' || !UID_RE.test(uid)) {
    return NextResponse.json({ error: 'Invalid uid' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('photos')
    .select('id, duration_seconds')
    .eq('stream_uid', uid)
    .limit(1)
    .maybeSingle<{ id: string; duration_seconds: number | null }>()
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  }

  const status = await getStreamVideoStatus(uid)

  // THE LENGTH WE STORE COMES FROM CLOUDFLARE, NOT FROM THE BROWSER.
  //
  // duration_seconds arrived in the upload request and nothing ever checked it. It is what the
  // album's video BUDGET is spent against, so declaring one second per clip let an album hold a
  // real hour while its accounting showed a minute — and Stream storage is a purchased ceiling
  // whose exhaustion makes every video upload fail for every album at once, which at an event is
  // the whole room. Cloudflare knows the true length once the video is ready; this is the first
  // moment it can be asked, and the client polls here anyway.
  //
  // Only ever corrected UPWARD-or-different, never invented: a null reading changes nothing. This
  // is reconciliation on the ordinary path, not enforcement — a client that never polls keeps its
  // claim until something sweeps it, which is a known residual, not a fix that half-works.
  if (status?.duration != null) {
    const measured = Math.max(1, Math.round(status.duration))
    if (row.duration_seconds !== measured) {
      const { error } = await admin.from('photos').update({ duration_seconds: measured }).eq('id', row.id)
      if (error) console.error('[video-status] duration reconcile failed:', error.message)
    }
  }
  // Unknown reads as ready on purpose. Showing the player's own error on a genuinely broken video
  // is a smaller failure than hiding a working one behind a notice that never clears.
  return NextResponse.json(
    { ready: status?.ready ?? true, pct: status?.pct ?? 0 },
    { headers: NO_STORE },
  )
}
