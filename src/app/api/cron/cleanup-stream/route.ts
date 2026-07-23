import { NextResponse } from 'next/server'
import { cleanupStaleStreamUploads } from '@/lib/cloudflare/stream'
import { timingSafeEqual } from '@/lib/timing-safe'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Daily sweep that deletes abandoned Cloudflare Stream uploads (non-ready, expiry already past),
// each of which reserves storage quota until removed. Same auth model as the other cron routes:
// invoked only by worker.ts's scheduled handler with the shared ALBUM_RETIREMENT_SECRET bearer.
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
    console.error('[cleanup-stream] failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500, headers: NO_STORE })
  }
}
