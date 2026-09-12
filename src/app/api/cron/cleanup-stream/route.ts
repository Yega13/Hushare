import { NextResponse } from 'next/server'
import { serverError } from '@/lib/server/respond'
import { cleanupStaleStreamUploads } from '@/lib/cloudflare/stream'
import { timingSafeEqual } from '@/lib/timing-safe'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// THREE-HOURLY sweep that deletes abandoned Cloudflare Stream uploads (non-ready, expiry already
// past), each of which reserves storage quota until removed. worker.ts runs it on EVERY_3_HOURS
// ('0 */3 * * *' in wrangler.toml); this header said "daily" and was simply wrong, which is the same
// class of defect as a comment giving a false reason — it just happened to be about a schedule.
// Same auth model as the other cron routes: invoked only by worker.ts's scheduled handler with the
// shared ALBUM_RETIREMENT_SECRET bearer.
//
// WHAT IT DOES NOT COVER, measured 2026-09-12: a video that uploaded COMPLETELY and was then refused
// at photos/create stays `ready` and unreferenced, and both of this sweep's guards skip it on
// purpose (non-ready only, and never a uid with a photos row). 45 such videos hold 14.6 minutes of
// the purchased ceiling; reclaiming them is a reconciliation, not a sweep — see ARCHITECTURE
// section 6, and note that a wrong deletion there destroys somebody's video with no backup.
// See cleanupStaleStreamUploads for why Cloudflare's own expiry reclamation isn't enough.
export async function POST(req: Request) {
  const secret = process.env.ALBUM_RETIREMENT_SECRET
  if (!secret || secret.length < 32) {
    console.error('[cleanup-stream] ALBUM_RETIREMENT_SECRET not set or too short; refusing to run')
    return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
  }
  const auth = req.headers.get('authorization') ?? ''
  if (!timingSafeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  try {
    const result = await cleanupStaleStreamUploads()
    console.log('[cleanup-stream]', JSON.stringify(result))
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE })
  } catch (e) {
    return serverError('cron/cleanup-stream', e instanceof Error ? e.message : String(e), { publicMessage: 'Cleanup failed' })
  }
}
