// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { useAccountIdentity, clearAccountIdentityCache } from '@/lib/use-account-identity'

// "ACCOUNT CHANGING TO ICON" — the flicker the owner reported.
//
// Sign-in state and profile picture were fetched separately, and the picture's fetch was gated on
// the sign-in state having already resolved. So the nav slot rendered three shapes in sequence:
// a transparent "Sign in" placeholder, then the word "Account" with a generic circle, then the
// photo with the word hidden by CSS. Two calls to the same endpoint, in series, for one answer.
//
// /api/me has always returned both fields in one response.
let calls = 0
let reply: unknown = { signedIn: true, avatarUrl: 'https://example.test/a.jpg' }

beforeEach(() => {
  calls = 0
  // Reset the canned response too, or a test that changes it leaks into the next one — which is
  // exactly what happened: the sign-out test left signedIn:false behind and the following test
  // failed against perfectly correct code.
  reply = { signedIn: true, avatarUrl: 'https://example.test/a.jpg' }
  clearAccountIdentityCache()
  vi.stubGlobal('fetch', vi.fn(async () => {
    calls++
    return { ok: true, json: async () => reply } as unknown as Response
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the account control settles in one step', () => {
  it('reports signed-in AND the picture from the same answer', async () => {
    const { result } = renderHook(() => useAccountIdentity())
    expect(result.current.status, 'starts unknown').toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('signed-in'))
    // The whole point: no intermediate render where we know they are signed in but not what they
    // look like. That gap is what swapped a word for an icon in front of the user.
    expect(result.current.avatarUrl).toBe('https://example.test/a.jpg')
  })

  it('asks /api/me ONCE however many controls want it', async () => {
    // The nav link and the mobile account button both want this. Before, they made a request each
    // — and each one costs a Supabase round trip plus a subscription lookup plus a profile query.
    const a = renderHook(() => useAccountIdentity())
    const b = renderHook(() => useAccountIdentity())
    await waitFor(() => expect(a.result.current.status).toBe('signed-in'))
    await waitFor(() => expect(b.result.current.status).toBe('signed-in'))
    expect(calls).toBe(1)
  })

  it('treats a 200 with signedIn:false as signed out', async () => {
    // /api/me NEVER returns 401 — it answers 200 with signedIn:false. The code watched for a 401,
    // so a visitor whose session had expired kept seeing "Account" and was bounced to /login when
    // they clicked it.
    reply = { signedIn: false, canAccessAccount: false }
    const { result } = renderHook(() => useAccountIdentity())
    await waitFor(() => expect(result.current.status).toBe('signed-out'))
    expect(result.current.avatarUrl).toBeNull()
  })

  it('never gets stuck loading when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const { result } = renderHook(() => useAccountIdentity())
    await waitFor(() => expect(result.current.status).toBe('signed-out'))
  })

  it('makes no request at all when it is not wanted', () => {
    renderHook(() => useAccountIdentity(false))
    expect(calls, 'a control that is not rendered on this breakpoint should not pay for the lookup').toBe(0)
  })

  it('re-asks every control when the identity actually changes', async () => {
    // Signing out in another tab. This used to reload the whole page — which, because
    // TOKEN_REFRESHED fires roughly hourly, would have restarted someone's upload once an hour.
    const { result } = renderHook(() => useAccountIdentity())
    await waitFor(() => expect(result.current.status).toBe('signed-in'))
    reply = { signedIn: false }
    await act(async () => { clearAccountIdentityCache() })
    await waitFor(() => expect(result.current.status).toBe('signed-out'))
    expect(calls, 'the cache was cleared, so exactly one more request').toBe(2)
  })
})
