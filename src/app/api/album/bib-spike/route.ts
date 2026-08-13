import { NextResponse } from 'next/server'
import { detectBibNumbers } from '@/lib/rekognition'

export const runtime = 'nodejs'
export const maxDuration = 60

// TEMPORARY de-risking endpoint: measures how well Rekognition DetectText reads race BIB NUMBERS
// off real race photos, before committing to the bib-search feature. Secret-guarded.
// DELETE once the spike is done.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { secret?: string; imageUrl?: string } | null
  if (!body || body.secret !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (typeof body.imageUrl !== 'string') {
    return NextResponse.json({ error: 'imageUrl required' }, { status: 400 })
  }
  const t0 = Date.now()
  try {
    const bibs = await detectBibNumbers(body.imageUrl, 0)  // 0 = report everything, spike measures
    return NextResponse.json({ bibs, ms: Date.now() - t0 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), ms: Date.now() - t0 }, { status: 500 })
  }
}
