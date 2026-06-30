import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { hasAccountAccess } from '@/lib/access'

export const runtime = 'nodejs'

// Magic-link / OAuth landing. Supabase redirects here with a `code` param after
// the user clicks an email link or completes OAuth consent. We exchange the code
// for a session, write the session cookie onto the redirect response, and forward.
//
// We create the Supabase client directly here (not via the shared createClient
// helper) so we can write cookies onto the NextResponse.redirect we return.
// The shared helper uses cookies() from next/headers which only writes to a
// separate cookie header that gets lost when combined with a redirect response.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const rawNext = url.searchParams.get('next') ?? ''

  // Normalize via URL constructor before validating — blocks encoded bypasses like
  // /%2F%2Fevil.com or ///evil.com that pass naive startsWith('/') checks.
  let requestedNext: string | null = null
  if (rawNext) {
    try {
      const parsed = new URL(rawNext, url.origin)
      if (parsed.origin === url.origin) requestedNext = parsed.pathname + parsed.search
    } catch { /* invalid URL — leave null */ }
  }

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin))
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[auth/callback] Supabase env vars not set')
    return NextResponse.redirect(new URL('/login?error=config', url.origin))
  }

  const pendingCookies: Array<{ name: string; value: string; options: CookieOptions }> = []
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return req.cookies.getAll() },
      setAll(cookiesToSet) { for (const c of cookiesToSet) pendingCookies.push(c) },
    },
  })

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchange failed:', error.message)
    return NextResponse.redirect(new URL('/login?error=invalid_code', url.origin))
  }

  if (!data.user) {
    console.error('[auth/callback] exchangeCodeForSession returned no user with no error — code may have been consumed already')
    return NextResponse.redirect(new URL('/login?error=invalid_code', url.origin))
  }

  // Authentication has already succeeded here. Don't let a failure in the
  // (admin-client) subscription lookup turn a successful login into a 500 — fall
  // back to treating the user as a non-subscriber so they still land logged in.
  let allowed = false
  try {
    allowed = await hasAccountAccess(data.user)
  } catch (e) {
    console.error('[auth/callback] access check failed; logging in anyway:', e instanceof Error ? e.message : String(e))
  }
  const target = allowed
    ? requestedNext ?? '/account'
    : requestedNext && !requestedNext.startsWith('/account') ? requestedNext : '/'

  const response = NextResponse.redirect(new URL(target, url.origin))
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options)
  }
  return response
}
