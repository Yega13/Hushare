import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// THE SECRET THAT LOOKS REVOKED WHEN IT IS ONLY UNTIDY.
//
// Polar answers 401 `invalid_token` with a body listing four causes — "expired, revoked, malformed,
// or invalid for other reasons" — and never says which. A trailing newline on the secret produces
// `Authorization: Bearer <token>\n`, which is malformed, which is a 401. So a perfectly good token
// reads exactly like a revoked one, and the search goes to the Polar dashboard instead of to the
// whitespace.
//
// lib/email.ts already carries this scar on a recipient address: "a value set with
// `echo x | wrangler secret put` carries a trailing newline". Same mistake, different secret.

const NEWLINE = String.fromCharCode(10)

let calls: Array<{ url: string; auth: string }> = []
const realFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  vi.stubEnv('POLAR_SANDBOX', 'false')
  globalThis.fetch = (async (url: unknown, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization ?? '' })
    return { ok: true, json: async () => ({ items: [], pagination: { max_page: 1 } }), text: async () => '' } as unknown as Response
  }) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  vi.unstubAllEnvs()
  vi.resetModules()
})

/** Freshly imported each time, because the module warns only once per process. */
async function listWith(secret: string) {
  vi.stubEnv('POLAR_API_KEY', secret)
  vi.resetModules()
  const { listRecentOrders } = await import('@/lib/polar')
  await listRecentOrders(1)
  return calls[0]
}

describe('a secret with stray whitespace still authenticates', () => {
  it('strips a trailing newline before it reaches the header', async () => {
    // THE BUG. Without the trim this sends "Bearer polar_oat_abc123\n", Polar rejects it as
    // malformed, and the 401 is indistinguishable from a revoked token.
    const call = await listWith(`polar_oat_abc123${NEWLINE}`)
    expect(call.auth).toBe('Bearer polar_oat_abc123')
    expect(call.auth).not.toContain(NEWLINE)
  })

  it('strips spaces on either side', async () => {
    const call = await listWith('  polar_oat_abc123  ')
    expect(call.auth).toBe('Bearer polar_oat_abc123')
  })

  it('leaves a clean secret exactly as it is', async () => {
    const call = await listWith('polar_oat_abc123')
    expect(call.auth).toBe('Bearer polar_oat_abc123')
  })
})

describe('a secret that cannot work says so instead of failing as a 401', () => {
  it('refuses a value that is only whitespace', async () => {
    vi.stubEnv('POLAR_API_KEY', `   ${NEWLINE}  `)
    vi.resetModules()
    const { listRecentOrders } = await import('@/lib/polar')
    await expect(listRecentOrders(1)).rejects.toThrow(/whitespace/i)
  })

  it('warns when the value is not a Polar token at all, without printing it', async () => {
    // The webhook secret and a truncated paste both answer 401 and look identical to a revoked
    // token. This is the line that tells them apart — and it must never leak the secret itself.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await listWith('whsec_not_a_polar_token')
    const said = warn.mock.calls.map((c) => c.map(String).join(' ')).join(' | ')
    expect(said).toContain('does not start with')
    expect(said, 'a log line must never carry the secret').not.toContain('whsec_not_a_polar_token')
    warn.mockRestore()
  })

  it('says nothing about a well-formed token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await listWith('polar_oat_abc123')
    expect(warn.mock.calls, 'a healthy secret must be silent, or the warning is noise').toHaveLength(0)
    warn.mockRestore()
  })
})
