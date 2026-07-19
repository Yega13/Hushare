import { NextResponse } from 'next/server'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { track } from '@/lib/analytics'

export const runtime = 'nodejs'

const VERIFIED_FROM = 'Hushare Support <support@hushare.space>'
const FALLBACK_FROM = 'Hushare Support <onboarding@resend.dev>'
const SUPPORT_TO    = 'husharesupport@gmail.com'

type Body = {
  name?: string
  email?: string
  subject?: string
  message?: string
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

  const rl = await checkRateLimit(clientIpKey(req, 'support'), 3600, 5, { failOpen: true })
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

  const name    = sanitizeLine(body.name ?? '').slice(0, 80)
  const email   = sanitizeLine(body.email ?? '').slice(0, 120)
  const subject = sanitizeLine(body.subject ?? '').slice(0, 120)
  const message = sanitizeBlock(body.message ?? '').slice(0, 4000)

  if (!email || !EMAIL_RE.test(email)) {
    return json(400, { error: 'Please enter a valid email' })
  }
  if (!message) {
    return json(400, { error: 'Please write a message' })
  }

  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY
  if (turnstileSecret) {
    const token = (body.turnstileToken ?? '').trim()
    if (!token) {
      return json(400, { error: 'Please complete the verification' })
    }
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
        console.warn('[support] Turnstile failed:', result['error-codes'])
        return json(403, { error: 'Verification failed - please try again' })
      }
    } catch (err) {
      console.error('[support] Turnstile verify request failed:', err)
      return json(502, { error: 'Verification service unavailable' })
    }
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[support] RESEND_API_KEY not set - message dropped')
    return json(503, { error: "Our message system isn't configured yet" })
  }

  const domainVerified = process.env.RESEND_DOMAIN_VERIFIED === 'true'
  const fromAddress    = domainVerified ? VERIFIED_FROM : FALLBACK_FROM
  const toAddress      = SUPPORT_TO

  const safeName    = name || '(no name)'
  const subjectLine = subject || 'Hushare support - new message'

  const text = [
    'New support message',
    '',
    `From: ${safeName} <${email}>`,
    `Subject: ${subjectLine}`,
    '',
    '----',
    message,
    '----',
    '',
    `Reply directly to this email to respond to ${safeName}.`,
  ].join('\n')

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; color: #630826; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="margin: 0 0 16px; font-size: 18px;">New support message</h2>
      <p style="margin: 0 0 8px; color: #5C4A3C;"><strong>From:</strong> ${escapeHtml(safeName)} &lt;${escapeHtml(email)}&gt;</p>
      <p style="margin: 0 0 8px; color: #5C4A3C;"><strong>Subject:</strong> ${escapeHtml(subjectLine)}</p>
      <hr style="border: none; border-top: 1px solid #E8E0D0; margin: 16px 0;" />
      <pre style="white-space: pre-wrap; font-family: inherit; font-size: 14px; line-height: 1.5; color: #5C4A3C; margin: 0;">${escapeHtml(message)}</pre>
      <hr style="border: none; border-top: 1px solid #E8E0D0; margin: 24px 0 12px;" />
      <p style="margin: 0; color: #B0A090; font-size: 12px;">Reply directly to this email to respond to ${escapeHtml(safeName)}.</p>
    </div>
  `

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [toAddress],
        reply_to: email,
        subject: `[Support] ${subjectLine}`,
        html,
        text,
      }),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error('[support] Resend error:', res.status, errBody)
      return json(502, { error: 'Our mail service rejected the message' })
    }

    track({ name: 'support_submitted' })
    return json(200, { ok: true })
  } catch (err) {
    console.error('[support] fetch failed:', err)
    return json(502, { error: 'Network error reaching our mail service' })
  }
}
