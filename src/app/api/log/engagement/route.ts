import { NextResponse } from 'next/server'
import { track } from '@/lib/analytics'
import { getVisitorContext } from '@/lib/visitor-context'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Where the browser reports what a page was actually like to use.
//
// Everything arriving here is written by a client and must be treated as hostile, even though the
// only thing it can reach is a statistics dataset. The damage a forged request could do is not a
// breach — it is a dashboard that quietly lies, which is worse than a dashboard that is missing,
// because a wrong number still gets acted on.
//
// So: every field is checked against a fixed shape, every string against an ALLOWLIST rather than a
// filter, and every number clamped into a range. Nothing is passed through on trust.

// Page names are an allowlist, not free text, and this is the single most important line in the
// file. A free-text page name lets one request invent a new row in the dashboard, and a script
// could invent a hundred thousand of them — the table would still render, just uselessly.
const PAGES = new Set(['album', 'home', 'pricing', 'account', 'statement', 'login', 'other'])
const STEPS = new Set(['picked', 'started', 'done', 'failed'])
const KINDS = new Set(['rage', 'dead'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Beacons are small by construction. Anything larger is not one of ours.
const MAX_BYTES = 2048

const int = (v: unknown, min: number, max: number): number => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

// Labels are lifted from the DOM, so they can carry anything a page can contain. Control characters
// are removed and the length is capped — the admin view renders these, and React escapes markup,
// but a stray newline or a 4KB label would wreck the table on its own.
const label = (v: unknown): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, 40) : ''

const albumId = (v: unknown): string | null =>
  typeof v === 'string' && UUID_RE.test(v) ? v : null

export async function POST(req: Request) {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  // Generous, because a guest at an event legitimately loads many pages and uploads many files, and
  // failOpen because losing a statistic must never cost anything. This grants nothing, so the limit
  // exists to bound cost and noise rather than to protect access.
  const rl = await checkRateLimit(clientIpKey(req, 'engagement'), 3600, 400, { failOpen: true })
  if (!rl.ok) return NextResponse.json({ ok: true }, { headers: NO_STORE })

  const raw = await req.text().catch(() => '')
  if (!raw || raw.length > MAX_BYTES) return NextResponse.json({ ok: true }, { headers: NO_STORE })

  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  }

  // Always 200, whatever happens. A beacon has nobody listening for the answer, and a 4xx would only
  // ever show up as noise in the browser console of someone using the product normally.
  try {
    const visitor = await getVisitorContext()

    // ── One upload step ──
    const upload = body.upload as Record<string, unknown> | undefined
    if (upload && typeof upload === 'object') {
      const step = String(upload.step ?? '')
      if (STEPS.has(step)) {
        track(
          {
            name: 'upload_funnel',
            albumId: albumId(upload.albumId),
            step: step as 'picked' | 'started' | 'done' | 'failed',
            count: int(upload.count, 0, 10_000),
            // Capped at 1 GB/s, which no real connection reaches — a bound, not a claim.
            kbps: int(upload.kbps, 0, 1_000_000),
            source: 'guest',
          },
          visitor,
        )
      }
      return NextResponse.json({ ok: true }, { headers: NO_STORE })
    }

    // ── A finished page view ──
    const page = String(body.page ?? '')
    if (!PAGES.has(page)) return NextResponse.json({ ok: true }, { headers: NO_STORE })

    const id = albumId(body.albumId)
    track(
      {
        name: 'page_engaged',
        page,
        albumId: id,
        dwellSeconds: int(body.dwellSeconds, 0, 1800),
        scrollPct: int(body.scrollPct, 0, 100),
        active: body.active === true,
      },
      visitor,
    )

    // Capped at 5 per page: a genuinely stuck person can generate a great many, and the useful fact
    // is that it happened here at all.
    const friction = Array.isArray(body.friction) ? body.friction.slice(0, 5) : []
    for (const f of friction) {
      const item = f as Record<string, unknown>
      const kind = String(item?.kind ?? '')
      const text = label(item?.label)
      if (!KINDS.has(kind) || !text) continue
      track({ name: 'friction', page, albumId: id, kind: kind as 'rage' | 'dead', label: text }, visitor)
    }
  } catch {
    // Recording how a page felt must never be able to affect the page.
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
