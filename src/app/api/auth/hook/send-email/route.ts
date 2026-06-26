import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Svix-style HMAC verification for Supabase auth webhooks.
// Secret format: 'v1,whsec_<base64>' or plain base64.
function verifyWebhook(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
  sigHeader: string,
): boolean {
  const base64Secret = secret.replace(/^v1,whsec_/, '')
  const key = Buffer.from(base64Secret, 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
  let match = false
  for (const sig of sigHeader.split(' ')) {
    const val = sig.replace(/^v1,/, '')
    try {
      if (timingSafeEqual(Buffer.from(val, 'base64'), Buffer.from(expected, 'base64'))) match = true
    } catch { /* length mismatch — not equal */ }
  }
  return match
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'

type ActionType =
  | 'signup'
  | 'magiclink'
  | 'recovery'
  | 'invite'
  | 'email_change_new'
  | 'email_change_current'

interface HookPayload {
  user: { id: string; email: string }
  email_data: {
    token_hash: string
    redirect_to: string
    email_action_type: ActionType
    token_hash_new?: string
  }
}

function confirmUrl(tokenHash: string, type: ActionType, redirectTo: string): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL not set')
  return (
    `${supabaseUrl}/auth/v1/verify` +
    `?token=${encodeURIComponent(tokenHash)}` +
    `&type=${type}` +
    `&redirect_to=${encodeURIComponent(redirectTo || SITE_URL)}`
  )
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function buildEmail(
  heading: string,
  body: string,
  ctaUrl: string,
  ctaLabel: string,
): { html: string; text: string } {
  const MAILING_ADDRESS = process.env.MAILING_ADDRESS ?? 'Hushare, Yerevan, Armenia'
  const html = `
<div style="font-family:-apple-system,system-ui,sans-serif;color:#254F22;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 16px;font-size:18px;">${escapeHtml(heading)}</h2>
  <p style="margin:0 0 20px;color:#5C4A3C;">${escapeHtml(body)}</p>
  <a href="${escapeHtml(ctaUrl)}"
     style="display:inline-block;background:#254F22;color:#FDFAF5;text-decoration:none;border-radius:10px;padding:10px 22px;font-size:14px;font-weight:600;">
    ${escapeHtml(ctaLabel)}
  </a>
  <p style="margin:20px 0 0;color:#B0A090;font-size:12px;">
    If you didn't request this, you can safely ignore this email.<br/>
    <a href="${escapeHtml(SITE_URL)}" style="color:#B0A090;">Hushare</a> &middot; ${escapeHtml(MAILING_ADDRESS)}
  </p>
</div>`
  const text = `${heading}\n\n${body}\n\n${ctaLabel}: ${ctaUrl}\n\nIf you didn't request this, ignore this email.\nHushare · ${MAILING_ADDRESS}`
  return { html, text }
}

async function sendViaResend(to: string, subject: string, html: string, text: string) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY
  const FROM =
    process.env.RESEND_DOMAIN_VERIFIED === 'true'
      ? 'Hushare <noreply@hushare.space>'
      : 'Hushare <onboarding@resend.dev>'
  if (!RESEND_API_KEY || RESEND_API_KEY === 'FILL_ME_IN') {
    console.error('[auth-hook] RESEND_API_KEY not configured — email not sent')
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  })
  if (!res.ok) {
    console.error('[auth-hook] Resend error:', res.status, await res.text())
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const HOOK_SECRET = process.env.SUPABASE_AUTH_HOOK_SECRET

  if (!HOOK_SECRET) {
    console.error('[auth-hook] SUPABASE_AUTH_HOOK_SECRET not set — refusing all requests')
    return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }

  const id = req.headers.get('webhook-id') ?? ''
  const timestamp = req.headers.get('webhook-timestamp') ?? ''
  const signature = req.headers.get('webhook-signature') ?? ''

  // Reject stale webhooks before verifying the signature — prevents indefinite replay attacks.
  const webhookTs = Number(timestamp)
  if (!Number.isFinite(webhookTs) || Math.abs(Date.now() / 1000 - webhookTs) > 300) {
    return NextResponse.json({ error: 'Stale request' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }

  if (!verifyWebhook(HOOK_SECRET, id, timestamp, rawBody, signature)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }

  let payload: HookPayload
  try {
    payload = JSON.parse(rawBody) as HookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const { user, email_data } = payload
  if (!user?.email || !email_data?.token_hash) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const { token_hash, redirect_to, email_action_type } = email_data

  // Validate redirect_to is same-origin before embedding in the confirm URL.
  let safeRedirectTo = SITE_URL
  if (redirect_to) {
    try {
      const parsedRedirect = new URL(redirect_to)
      if (parsedRedirect.origin === new URL(SITE_URL).origin) {
        safeRedirectTo = redirect_to
      } else {
        console.warn('[auth-hook] redirect_to is not same-origin, falling back to SITE_URL:', redirect_to)
      }
    } catch {
      // Malformed URL — use SITE_URL
    }
  }

  let url: string
  try {
    url = confirmUrl(token_hash, email_action_type, safeRedirectTo)
  } catch (e) {
    console.error('[auth-hook] confirmUrl failed:', e)
    return NextResponse.json({ error: 'Config error' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }

  let subject: string
  let email: { html: string; text: string }

  switch (email_action_type) {
    case 'magiclink':
      subject = 'Your Hushare sign-in link'
      email = buildEmail(
        'Sign in to Hushare',
        'Click the button below to sign in. This link expires in 1 hour and can only be used once.',
        url,
        'Sign in',
      )
      break
    case 'signup':
      subject = 'Confirm your Hushare account'
      email = buildEmail(
        'Confirm your email',
        'Click the button below to confirm your email and activate your account.',
        url,
        'Confirm email',
      )
      break
    case 'recovery':
      subject = 'Reset your Hushare password'
      email = buildEmail(
        'Reset your password',
        'Click the button below to reset your password. This link expires in 1 hour.',
        url,
        'Reset password',
      )
      break
    case 'invite':
      subject = "You've been invited to Hushare"
      email = buildEmail(
        "You've been invited",
        'Click the button below to accept your invitation and set up your account.',
        url,
        'Accept invitation',
      )
      break
    case 'email_change_new':
    case 'email_change_current':
      subject = 'Confirm your new email — Hushare'
      email = buildEmail(
        'Confirm email change',
        'Click the button below to confirm your new email address.',
        url,
        'Confirm email',
      )
      break
    default:
      subject = 'Action required — Hushare'
      email = buildEmail('Action required', 'Click the button below to continue.', url, 'Continue')
  }

  // Always return 200 — auth must never be blocked by an email failure
  await sendViaResend(user.email, subject, email.html, email.text)
  return NextResponse.json({}, { headers: { 'Cache-Control': 'no-store' } })
}
