import { describe, it, expect, vi, afterEach } from 'vitest'
import { authChannelName, isIdentityChange, watchAuthFromOtherTabs, IDENTITY_EVENTS } from '@/lib/auth-tab-sync'

// A SIGN-IN OR SIGN-OUT IN ANOTHER TAB, HEARD WITHOUT LOADING supabase-js ON A MARKETING PAGE.
//
// The listener is only worth anything if it listens where supabase-js actually posts. So the channel
// name is checked against the storage key the REAL client computes for this project's URL (rule 13:
// the formula is copied because importing it would import the library, so the copy is held to the
// original here), and the delivery is checked with real BroadcastChannels, not a fake of one.

const PROJECT_URL = 'https://yqngmyjquwemwogdyuwv.supabase.co'
const opened: BroadcastChannel[] = []
const channel = (name: string) => { const c = new BroadcastChannel(name); opened.push(c); return c }
afterEach(() => { while (opened.length) opened.pop()!.close() })

// Messages between BroadcastChannels arrive asynchronously.
const settle = () => new Promise((r) => setTimeout(r, 20))

describe('the channel supabase-js posts on', () => {
  it('is named exactly as the real client names its storage key', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const client = createClient(PROJECT_URL, 'anon-key-for-a-test', { auth: { autoRefreshToken: false, persistSession: false } })
    const realKey = (client.auth as unknown as { storageKey: string }).storageKey
    expect(realKey, 'the real client must expose a storage key for this to prove anything').toMatch(/^sb-/)
    expect(authChannelName(PROJECT_URL)).toBe(realKey)
  })

  it('an unparseable URL has no channel rather than a wrong one', () => {
    expect(authChannelName('not a url')).toBeNull()
  })
})

describe('which messages mean the identity changed', () => {
  it('sign-in, sign-out and a user update do', () => {
    for (const event of IDENTITY_EVENTS) expect(isIdentityChange({ event, session: null }), event).toBe(true)
  })

  it('an hourly token refresh does not -- reacting to it re-asked on a schedule for an unchanged answer', () => {
    expect(isIdentityChange({ event: 'TOKEN_REFRESHED', session: {} })).toBe(false)
    expect(isIdentityChange({ event: 'INITIAL_SESSION', session: null })).toBe(false)
  })

  it('anything else on the channel is ignored, never thrown on', () => {
    for (const junk of [null, undefined, 'SIGNED_OUT', 42, {}, { event: 7 }]) expect(isIdentityChange(junk)).toBe(false)
  })
})

describe('watchAuthFromOtherTabs, over real BroadcastChannels', () => {
  const deps = { url: PROJECT_URL, Channel: BroadcastChannel }
  const name = authChannelName(PROJECT_URL)!

  it('ANOTHER TAB SIGNING OUT reaches this page', async () => {
    const onChange = vi.fn()
    const stop = watchAuthFromOtherTabs(onChange, deps)
    channel(name).postMessage({ event: 'SIGNED_OUT', session: null })
    await settle()
    expect(onChange).toHaveBeenCalledTimes(1)
    stop()
  })

  it('a token refresh in another tab does not', async () => {
    const onChange = vi.fn()
    const stop = watchAuthFromOtherTabs(onChange, deps)
    channel(name).postMessage({ event: 'TOKEN_REFRESHED', session: {} })
    await settle()
    expect(onChange).not.toHaveBeenCalled()
    stop()
  })

  it("another project's channel is not this one", async () => {
    const onChange = vi.fn()
    const stop = watchAuthFromOtherTabs(onChange, deps)
    channel('sb-someotherproject-auth-token').postMessage({ event: 'SIGNED_OUT', session: null })
    await settle()
    expect(onChange).not.toHaveBeenCalled()
    stop()
  })

  it('after cleanup nothing arrives, and the channel is closed', async () => {
    const onChange = vi.fn()
    const closeSpy = vi.spyOn(BroadcastChannel.prototype, 'close')
    const stop = watchAuthFromOtherTabs(onChange, deps)
    stop()
    expect(closeSpy).toHaveBeenCalled()
    closeSpy.mockRestore()
    channel(name).postMessage({ event: 'SIGNED_IN', session: {} })
    await settle()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('with no project URL or no BroadcastChannel it does nothing, and does not throw', () => {
    expect(() => watchAuthFromOtherTabs(() => {}, { url: undefined, Channel: BroadcastChannel })()).not.toThrow()
    expect(() => watchAuthFromOtherTabs(() => {}, { url: PROJECT_URL, Channel: undefined })()).not.toThrow()
  })

  it('a BroadcastChannel that refuses to open (an opaque origin) costs the page nothing', () => {
    const Refusing = class { constructor() { throw new DOMException('refused', 'SecurityError') } } as unknown as typeof BroadcastChannel
    expect(() => watchAuthFromOtherTabs(() => {}, { url: PROJECT_URL, Channel: Refusing })()).not.toThrow()
  })
})
