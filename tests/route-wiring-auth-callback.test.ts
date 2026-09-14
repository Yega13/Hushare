import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// THE SIGN-IN CALLBACK REDIRECTS ONLY TO THIS SITE -- asserted on the real route's Location header.
//
// lib/safe-next is tested on its own; this runs the route a magic link or Google sign-in lands on, with
// the session exchange faked, and reads where the response actually sends the browser. Before the fix,
// next=https://hushare.space//evil.example passed its same-origin check and the Location was
// //evil.example -- a new session handed straight to a lookalike page.

const state = { allowed: true }

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { exchangeCodeForSession: async () => ({ data: { user: { id: 'user-1', email: 'guest@example.test' } }, error: null }) },
  }),
}))
vi.mock('@/lib/access', () => ({ hasAccountAccess: async () => state.allowed }))

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-key-for-a-test'

const { GET } = await import('@/app/auth/callback/route')

const ORIGIN = 'https://hushare.space'
const BS = String.fromCharCode(92)

async function landing(next: string): Promise<URL> {
  const url = new URL('/auth/callback', ORIGIN)
  url.searchParams.set('code', 'one-time-code')
  url.searchParams.set('next', next)
  const res = await GET(new NextRequest(url))
  const location = res.headers.get('location')
  expect(location, 'the callback must answer with a redirect').not.toBeNull()
  // Resolved exactly as the browser resolves a Location header.
  return new URL(location as string, ORIGIN)
}

beforeEach(() => { state.allowed = true })

describe('auth/callback sends the new session only to this site', () => {
  it('THE DOUBLE-SLASH LINK lands on our own account page, not evil.example', async () => {
    const at = await landing('https://hushare.space//evil.example')
    expect(at.origin).toBe(ORIGIN)
    expect(at.pathname).toBe('/account')
  })

  it('THE BACKSLASH LINK lands on our own account page too', async () => {
    const at = await landing(`https://hushare.space/${BS}evil.example`)
    expect(at.origin).toBe(ORIGIN)
  })

  it('a real page on this site is where it returns', async () => {
    const at = await landing('/abcd1234?s=qr')
    expect(`${at.origin}${at.pathname}${at.search}`).toBe(`${ORIGIN}/abcd1234?s=qr`)
  })

  it('an account without account access is still kept off /account, and off-site', async () => {
    state.allowed = false
    expect((await landing('/account/billing')).pathname).toBe('/')
    expect((await landing('https://hushare.space//evil.example')).origin).toBe(ORIGIN)
  })
})
