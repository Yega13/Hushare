import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'

// Step 1 of "Sign in with TikTok": send the user to TikTok's authorize screen.
// TikTok redirects them back to /api/auth/tiktok/callback with a `code`, which that
// route exchanges for a token → user info → a Hushare (Supabase) session.
//
// TikTok web is a CONFIDENTIAL client: it authenticates the token exchange with the
// client_secret and does NOT use PKCE (that's mobile/desktop only), so we send no
// code_challenge here. See the TikTok Login implementation spec.

const TIKTOK_AUTHORIZE = 'https://www.tiktok.com/v2/auth/authorize/'
// Must EXACTLY match the redirect URI registered in the TikTok app (and it lives on our
// own verified domain — the Supabase callback can't be used because supabase.co isn't ours
// to verify).
const REDIRECT_URI = 'https://hushare.space/api/auth/tiktok/callback'

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Only allow same-origin return paths — never an attacker-supplied absolute URL.
function safeNext(raw: string | null, origin: string): string {
  if (!raw) return '/'
  try {
    const u = new URL(raw, origin)
    return u.origin === origin ? u.pathname + u.search : '/'
  } catch {
    return '/'
  }
}

export async function GET(req: NextRequest) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY
  if (!clientKey) {
    console.error('[tiktok/start] TIKTOK_CLIENT_KEY not set')
    return NextResponse.redirect(new URL('/login?error=tiktok_config', req.url))
  }

  const url = new URL(req.url)
  const next = safeNext(url.searchParams.get('next'), url.origin)
  const state = randomState()
  // Scopes are env-driven so we can add `user.info.profile` (for the @username) the moment
  // TikTok approves it — no code change. TikTok wants scopes comma-separated.
  const scopes = process.env.TIKTOK_SCOPES ?? 'user.info.basic'

  const authorize = new URL(TIKTOK_AUTHORIZE)
  authorize.searchParams.set('client_key', clientKey)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('scope', scopes)
  authorize.searchParams.set('redirect_uri', REDIRECT_URI)
  authorize.searchParams.set('state', state)

  const res = NextResponse.redirect(authorize.toString())
  // Short-lived, httpOnly cookies validated in the callback. SameSite=Lax so they survive
  // TikTok's top-level GET redirect back to us (Strict would drop them and break the flow).
  const cookieOpts = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: 600 }
  res.cookies.set('tiktok_oauth_state', state, cookieOpts)
  res.cookies.set('tiktok_oauth_next', next, cookieOpts)
  return res
}
