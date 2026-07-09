import { NextResponse } from 'next/server'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const FROM_VERIFIED = 'Hushare Reports <support@hushare.space>'
const FROM_FALLBACK = 'Hushare Reports <onboarding@resend.dev>'
const REPORT_TO     = 'husharesupport@gmail.com'

type Body = {
  albumTitle?: string
  albumUrl?: string
  albumSlug?: string
  reason?: string
  details?: string
  reporterEmail?: string
  turnstileToken?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const NO_STORE = { 'Cache-Control': 'no-store' }

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function sanitizeLine(str: string): string {
  return str.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim()
}

function sanitizeBlock(str: string): string {
  return str.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, ' ').trim()
}

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  const rl = await checkRateLimit(clientIpKey(req, 'report'), 3600, 10, { failOpen: true })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid request body' })
  }

  const albumTitle    = sanitizeLine(body.albumTitle ?? '').slice(0, 140) || 'Untitled album'
  const albumUrl      = sanitizeLine(body.albumUrl ?? '').slice(0, 500)
  const albumSlug     = sanitizeLine(body.albumSlug ?? '').slice(0, 80)
  const reason        = sanitizeLine(body.reason ?? '').slice(0, 140)
  const details       = sanitizeBlock(body.details ?? '').slice(0, 4000)
  const reporterEmail = sanitizeLine(body.reporterEmail ?? '').slice(0, 120)

  if (!reason) return json(400, { error: 'Please choose a report reason' })
  const VALID_REASONS = new Set([
    'Illegal or abusive content',
    'Harassment or privacy concern',
    'Spam, scam, or phishing',
    'Copyright or ownership issue',
    'Other',
  ])
  if (!VALID_REASONS.has(reason)) return json(400, { error: 'Invalid report reason' })
  if (reason === 'Other' && !details) {
    return json(400, { error: 'Please describe what is wrong' })
  }
  if (reporterEmail && !EMAIL_RE.test(reporterEmail)) {
    return json(400, { error: 'Please enter a valid email or leave it blank' })
  }

  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY
  if (turnstileSecret) {
    const token = sanitizeLine(body.turnstileToken ?? '')
    if (!token) return json(400, { error: 'Please complete the verification' })

    try {
      const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: turnstileSecret,
          response: token,
          remoteip: req.headers.get('cf-connecting-ip') ?? '',
        }),
      })
      const result = (await verify.json()) as { success: boolean; 'error-codes'?: string[] }
      if (!result.success) {
        console.warn('[report] Turnstile failed:', result['error-codes'])
        return json(403, { error: 'Verification failed - please try again' })
      }
    } catch (err) {
      console.error('[report] Turnstile verify request failed:', err)
      return json(502, { error: 'Verification service unavailable' })
    }
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[report] RESEND_API_KEY not set - report dropped')
    return json(503, { error: "Our report system isn't configured yet" })
  }

  const from = process.env.RESEND_DOMAIN_VERIFIED === 'true' ? FROM_VERIFIED : FROM_FALLBACK

  const text = [
    'URGENT Hushare album report',
    '',
    `Reason: ${reason}`,
    `Album: ${albumTitle}`,
    `Slug: ${albumSlug || '(not provided)'}`,
    `Link: ${albumUrl || '(not provided)'}`,
    `Reporter email: ${reporterEmail || '(not provided)'}`,
    '',
    'Details:',
    details || '(none)',
  ].join('\n')

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; color: #630826; max-width: 620px; margin: 0 auto; padding: 24px;">
      <p style="margin: 0 0 12px; color: #8A0032; font-weight: 800; letter-spacing: 0.08em;">URGENT ALBUM REPORT</p>
      <h2 style="margin: 0 0 16px; font-size: 20px;">${escapeHtml(reason)}</h2>
      <p style="margin: 0 0 8px; color: #5C4A3C;"><strong>Album:</strong> ${escapeHtml(albumTitle)}</p>
      <p style="margin: 0 0 8px; color: #5C4A3C;"><strong>Slug:</strong> ${escapeHtml(albumSlug || '(not provided)')}</p>
      <p style="margin: 0 0 8px; color: #5C4A3C;"><strong>Link:</strong> ${escapeHtml(albumUrl || '(not provided)')}</p>
      <p style="margin: 0 0 16px; color: #5C4A3C;"><strong>Reporter email:</strong> ${escapeHtml(reporterEmail || '(not provided)')}</p>
      <hr style="border: none; border-top: 1px solid #E8E0D0; margin: 16px 0;" />
      <pre style="white-space: pre-wrap; font-family: inherit; font-size: 14px; line-height: 1.5; color: #5C4A3C; margin: 0;">${escapeHtml(details || '(none)')}</pre>
    </div>
  `

  try {
    const payload: Record<string, unknown> = {
      from,
      to: [REPORT_TO],
      subject: `[URGENT REPORT] ${reason} - ${albumTitle}`,
      html,
      text,
      headers: {
        'X-Priority': '1',
        Priority: 'urgent',
        Importance: 'high',
      },
    }
    if (reporterEmail) payload.reply_to = reporterEmail

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error('[report] Resend error:', res.status, errBody)
      return json(502, { error: 'Our mail service rejected the report' })
    }

    return json(200, { ok: true })
  } catch (err) {
    console.error('[report] fetch failed:', err)
    return json(502, { error: 'Network error reaching our mail service' })
  }
}
