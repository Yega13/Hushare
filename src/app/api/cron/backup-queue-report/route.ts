import { NextResponse } from 'next/server'
import { timingSafeEqual } from '@/lib/timing-safe'
import { reportServerError } from '@/lib/report-server-error'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const SOURCE = 'queue/media-backup'

/** One level of strings and finite numbers: what the backup queue reports, and nothing that can nest. */
const isFlatContext = (v: unknown): v is Record<string, string | number> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
  && Object.values(v).every((x) => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x)))

// THE PHOTO BACKUP QUEUE'S DOOR INTO THE ERROR PANEL.
//
// worker.ts's queue handler runs outside Next.js, so it cannot call the panel's reporter itself; it posts
// the sentence here with the cron secret (lib/server/media-backup: reportThroughSite). Every call writes a
// panel row, so a caller without the secret is refused before the body is read, and a body that is not one
// sentence with flat context is refused rather than stored. It lives under /api/cron because it shares
// their secret, and tests/architecture.test.ts holds every route there to comparing it.
export async function POST(req: Request) {
  const secret = process.env.ALBUM_RETIREMENT_SECRET ?? ''
  const auth = req.headers.get('Authorization') ?? ''
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!secret || !timingSafeEqual(provided, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }
  const body = (await req.json().catch(() => null)) as { message?: unknown; context?: unknown } | null
  if (typeof body?.message !== 'string' || !isFlatContext(body.context)) {
    return NextResponse.json({ error: 'Invalid report' }, { status: 400, headers: NO_STORE })
  }
  reportServerError(SOURCE, body.message, { context: body.context })
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
