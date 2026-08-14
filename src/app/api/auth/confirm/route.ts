import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { EmailOtpType } from '@supabase/supabase-js'
import { hasAccountAccess } from '@/lib/access'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// POST-only. The token is consumed here and nowhere else — see the long note in
// src/app/auth/confirm/page.tsx for why a GET must never do this (mail scanners follow links and
// burn one-time tokens; PKCE codes are bound to the browser that started the sign-in).
//
// verifyOtp() takes the token_hash straight from the auth email hook, so unlike
// exchangeCodeForSession() it needs no code_verifier and works when the mail is opened on a
// different device than the one that requested the link.

// Only these reach Supabase. An unknown value from the query string must never be forwarded.
const VALID_TYPES: ReadonlySet<string> = new Set<EmailOtpType>([
  'signup', 'magiclink', 'recovery', 'invite', 'email_change', 'email',
])

export async function POST(req: NextRequest) {
  const origin = new URL(req.url).origin

  // High-entropy token_hash makes guessing impractical, but a cheap IP cap keeps this from being a
  // free oracle. failOpen: true — a rate-limit store outage must not lock everyone out of signing in.
  const rl = await checkRateLimit(clientIpKey(req, 'auth_confirm'), 60, 20, { failOpen: true })
  if (!rl.ok) {
    return NextResponse.redirect(new URL('/login?error=rate_limited', origin), { status: 303 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.redirect(new URL('/login?error=invalid_code', origin), { status: 303 })
  }

  const tokenHash = String(form.get('token_hash') ?? '').trim()
  const rawType = String(form.get('type') ?? '').trim()
  const rawNext = String(form.get('next') ?? '').trim()

  if (!tokenHash || !VALID_TYPES.has(rawType)) {
    return NextResponse.redirect(new URL('/login?error=invalid_code', origin), { status: 303 })
  }

  // Same-origin only, normalized through the URL constructor so encoded bypasses
  // (//evil.com, /%2F%2Fevil.com) can't slip through a naive startsWith('/') check.
  let requestedNext: string | null = null
  if (rawNext) {
    try {
      const parsed = new URL(rawNext, origin)
      if (parsed.origin === origin) requestedNext = parsed.pathname + parsed.search
    } catch { /* malformed — ignore */ }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[auth/confirm] Supabase env vars not set')
    return NextResponse.redirect(new URL('/login?error=config', origin), { status: 303 })
  }

  // Cookies are collected here and written onto the redirect response below — the cookies() helper
  // from next/headers writes to a header that gets dropped when a redirect is returned.
  const pendingCookies: Array<{ name: string; value: string; options: CookieOptions }> = []
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return req.cookies.getAll() },
      setAll(cookiesToSet) { for (const c of cookiesToSet) pendingCookies.push(c) },
    },
  })

  const { data, error } = await supabase.auth.verifyOtp({
    type: rawType as EmailOtpType,
    token_hash: tokenHash,
  })

  if (error || !data.user) {
    console.error('[auth/confirm] verifyOtp failed:', error?.message ?? 'no user returned')
    return NextResponse.redirect(new URL('/login?error=invalid_code', origin), { status: 303 })
  }

  // Every type lands the same way. There is no password in this product — sign-in is magic-link or
  // Google — so a 'recovery' link is just another way to end up signed in; there is no password
  // screen to send anyone to. If passwords are ever added, recovery needs to branch here.

  // Auth already succeeded. A failure in the subscription lookup must not turn a good sign-in into
  // an error page — fall back to treating them as a non-subscriber so they still land logged in.
  let allowed = false
  try {
    allowed = await hasAccountAccess(data.user)
  } catch (e) {
    console.error('[auth/confirm] access check failed; logging in anyway:', e instanceof Error ? e.message : String(e))
  }
  const target = allowed
    ? requestedNext ?? '/account'
    : requestedNext && !requestedNext.startsWith('/account') ? requestedNext : '/'

  // 303 so the browser follows with GET instead of re-POSTing to the destination.
  const response = NextResponse.redirect(new URL(target, origin), { status: 303 })
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options)
  }
  return response
}
