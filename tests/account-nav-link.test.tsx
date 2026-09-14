// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'

// THE NAV LINK HEARS ANOTHER TAB SIGN IN OR OUT, WITHOUT A SUPABASE CLIENT.
//
// lib/auth-tab-sync is proven on its own; this renders the real component and posts on the real
// channel the way supabase-js in another tab does, so the wiring -- listen, re-ask /api/me, render the
// new answer, stop listening on unmount -- is what is tested, not a description of it.

vi.mock('@/i18n/LocaleProvider', () => ({ useT: () => ({ t: (k: string) => k }) }))

const { default: AccountNavLink } = await import('@/components/AccountNavLink')
const { clearAccountIdentityCache } = await import('@/lib/use-account-identity')
const { authChannelName } = await import('@/lib/auth-tab-sync')

const PROJECT_URL = 'https://yqngmyjquwemwogdyuwv.supabase.co'
let reply: { signedIn: boolean; avatarUrl: string | null } = { signedIn: true, avatarUrl: null }
let meCalls = 0

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = PROJECT_URL
  reply = { signedIn: true, avatarUrl: null }
  meCalls = 0
  clearAccountIdentityCache()
  vi.stubGlobal('fetch', vi.fn(async () => { meCalls++; return { ok: true, json: async () => reply } as unknown as Response }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function fromAnotherTab(event: string) {
  const otherTab = new BroadcastChannel(authChannelName(PROJECT_URL)!)
  await act(async () => {
    otherTab.postMessage({ event, session: null })
    await new Promise((r) => setTimeout(r, 30))
  })
  otherTab.close()
}

describe('AccountNavLink and another tab', () => {
  it('A SIGN-OUT IN ANOTHER TAB turns "Account" back into "Sign in", without a reload', async () => {
    render(<AccountNavLink />)
    await waitFor(() => expect(screen.getByRole('link', { name: 'nav.account' })).toBeTruthy())
    reply = { signedIn: false, avatarUrl: null }
    await fromAnotherTab('SIGNED_OUT')
    await waitFor(() => expect(screen.getByRole('link', { name: 'nav.signIn' })).toBeTruthy())
    expect(meCalls, 'one more question, not a page reload').toBe(2)
  })

  it('an hourly token refresh in another tab asks nothing again', async () => {
    render(<AccountNavLink />)
    await waitFor(() => expect(screen.getByRole('link', { name: 'nav.account' })).toBeTruthy())
    await fromAnotherTab('TOKEN_REFRESHED')
    expect(meCalls).toBe(1)
  })

  it('once the link is gone it closes its channel', async () => {
    // Asserted on the CHANNEL, not on a request. After unmount nothing is subscribed to the identity
    // cache, so a leaked listener only clears a cache nobody reads -- no request would ever show it, and
    // a mutation that dropped the cleanup passed a request-counting version of this test.
    const close = vi.spyOn(BroadcastChannel.prototype, 'close')
    const { unmount } = render(<AccountNavLink />)
    await waitFor(() => expect(meCalls).toBe(1))
    expect(close, 'nothing closed while the link is on the page').not.toHaveBeenCalled()
    unmount()
    expect(close, 'an unmounted link must not keep a channel open').toHaveBeenCalledTimes(1)
    close.mockRestore()
  })
})
