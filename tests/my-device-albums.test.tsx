// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'

// "YOUR ALBUMS ON THIS DEVICE" KNOWS WHO IS SIGNED IN FROM /api/me, NOT FROM A SUPABASE CLIENT.
//
// The list reads its signed-in state from the same answer the nav link asks for, where it used to
// create a Supabase client -- putting supabase-js on the home page for one boolean. What must not change
// is what it shows: every remembered album to a signed-out visitor, only the ones NOT on the account
// (with an attach button) to a signed-in one, and NOTHING while it does not yet know which of the two
// it is looking at (rule 20: a list captioned "not on your account" cannot be shown before that is known).

vi.mock('@/i18n/LocaleProvider', () => ({ useT: () => ({ t: (k: string) => k }) }))
vi.mock('@/components/AppToast', () => ({ showAppToast: () => {} }))

const { default: MyDeviceAlbums } = await import('@/components/MyDeviceAlbums')
const { clearAccountIdentityCache } = await import('@/lib/use-account-identity')

const ON_ACCOUNT = { slug: 'on-account-album', token: 'tok-a', title: 'Already on the account', savedAt: 2 }
const DEVICE_ONLY = { slug: 'device-only-album', token: 'tok-b', title: 'Made while signed out', savedAt: 1 }

let me: Promise<{ signedIn: boolean }> = Promise.resolve({ signedIn: false })
const requested: string[] = []

beforeEach(() => {
  localStorage.setItem('hushare.myAlbums', JSON.stringify([ON_ACCOUNT, DEVICE_ONLY]))
  me = Promise.resolve({ signedIn: false })
  requested.length = 0
  clearAccountIdentityCache()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requested.push(url)
    if (url === '/api/me') return { ok: true, json: () => me } as unknown as Response
    if (url === '/api/album/exists') {
      return { ok: true, json: async () => ({ alive: [ON_ACCOUNT.slug, DEVICE_ONLY.slug], unclaimed: [DEVICE_ONLY.slug], binned: [] }) } as unknown as Response
    }
    throw new Error(`unexpected request ${url}`)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })

describe('MyDeviceAlbums', () => {
  it('signed out: every remembered album, under the device title', async () => {
    render(<MyDeviceAlbums />)
    await waitFor(() => expect(screen.getByText('myAlbums.title')).toBeTruthy())
    expect(screen.getByText(ON_ACCOUNT.title)).toBeTruthy()
    expect(screen.getByText(DEVICE_ONLY.title)).toBeTruthy()
    expect(requested, 'the signed-in state comes from /api/me').toContain('/api/me')
  })

  it('signed in: only the album that is NOT on the account, with the attach button', async () => {
    me = Promise.resolve({ signedIn: true })
    render(<MyDeviceAlbums />)
    await waitFor(() => expect(screen.getByText('claim.title')).toBeTruthy())
    expect(screen.getByText(DEVICE_ONLY.title)).toBeTruthy()
    expect(screen.queryByText(ON_ACCOUNT.title), 'an album already on the account is listed there, not here').toBeNull()
    expect(screen.getByRole('button', { name: 'claim.cta' })).toBeTruthy()
  })

  it('SHOWS NOTHING WHILE IT DOES NOT KNOW who is signed in, even after the album check answers', async () => {
    let answer: (v: { signedIn: boolean }) => void = () => {}
    me = new Promise((r) => { answer = r })
    const { container } = render(<MyDeviceAlbums />)
    await waitFor(() => expect(requested).toContain('/api/album/exists'))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(container.innerHTML, 'a guessed list is worse than no list').toBe('')
    await act(async () => { answer({ signedIn: false }) })
    await waitFor(() => expect(screen.getByText('myAlbums.title')).toBeTruthy())
  })
})
