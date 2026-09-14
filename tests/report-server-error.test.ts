import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// THE ONE PATH EVERY SERVER FAILURE TAKES TO THE PANEL -- 23 files import it -- and no test ran it.
//
// If this stops recording, the admin panel goes quiet about every server failure at once, and a quiet
// panel reads as a healthy product. It has been broken that way before: on Workers a pending promise is
// killed when the response returns, so a report that was not handed to waitUntil usually never landed.
//
// The database client and the Cloudflare context are mocked at the module boundary. What is sent, the
// keep-alive, and the fallback when coalescing fails are real.

type Rpc = { name: string; args: Record<string, unknown> }
type Insert = { table: string; row: Record<string, unknown> }

const cfg = {
  rpcError: null as { message: string } | null,
  noContext: false,
  clientThrows: false,
}
const rpcs: Rpc[] = []
const inserts: Insert[] = []
const waited: Array<Promise<unknown>> = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    if (cfg.clientThrows) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
    return {
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcs.push({ name, args })
        return Promise.resolve({ error: cfg.rpcError })
      },
      from: (table: string) => ({
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row })
          return Promise.resolve({ error: null })
        },
      }),
    }
  },
}))
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => {
    if (cfg.noContext) throw new Error('no Cloudflare context in dev')
    return { ctx: { waitUntil: (p: Promise<unknown>) => { waited.push(p) } } }
  },
}))

const { reportServerError, reportServerThrow } = await import('@/lib/report-server-error')

beforeEach(() => {
  cfg.rpcError = null
  cfg.noContext = false
  cfg.clientThrows = false
  rpcs.length = 0
  inserts.length = 0
  waited.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

describe('reportServerError', () => {
  it('records through the coalescing function, as an error, under server:<source>, with the album', async () => {
    reportServerError('checkout', 'Polar answered 502', { albumId: 'album-1', context: { step: 'create' } })
    await Promise.all(waited)
    expect(rpcs).toEqual([{
      name: 'coalesce_error_event',
      args: {
        p_level: 'error',
        p_source: 'server:checkout',
        p_message: 'Polar answered 502',
        p_album_id: 'album-1',
        p_context: { step: 'create' },
        p_ua: null,
      },
    }])
  })

  it('names the account for a failure that has no album, beside any context it already had', async () => {
    reportServerError('billing-portal', 'portal session failed', { account: 'owner@example.com', context: { plan: 'pro' } })
    await Promise.all(waited)
    expect(rpcs[0].args).toMatchObject({ p_album_id: null, p_context: { plan: 'pro', account: 'owner@example.com' } })
  })

  it('bounds the source at 60 characters and the message at 500', async () => {
    reportServerError('s'.repeat(100), 'm'.repeat(900))
    await Promise.all(waited)
    expect(String(rpcs[0].args.p_source)).toHaveLength(60)
    expect(String(rpcs[0].args.p_message)).toHaveLength(500)
  })

  it('KEEPS THE REPORT ALIVE PAST THE RESPONSE: it is handed to waitUntil', async () => {
    reportServerError('presign', 'boom')
    expect(waited, 'a report not handed to waitUntil is killed when the response returns').toHaveLength(1)
    await waited[0]
    expect(rpcs).toHaveLength(1)
  })

  it('a coalescing failure still records the error, by direct insert, inside the same keep-alive', async () => {
    cfg.rpcError = { message: 'function coalesce_error_event does not exist' }
    reportServerError('presign', 'boom', { albumId: 'album-2', context: { n: 1 } })
    expect(waited).toHaveLength(1)
    await waited[0]
    expect(inserts).toEqual([{
      table: 'error_events',
      row: { level: 'error', source: 'server:presign', message: 'boom', album_id: 'album-2', context: { n: 1 }, ua: null },
    }])
  })

  it('still records when there is no Cloudflare context (the dev server)', () => {
    cfg.noContext = true
    reportServerError('presign', 'boom')
    expect(rpcs).toHaveLength(1)
    expect(waited).toHaveLength(0)
  })

  it('never throws -- a failure to record a failure must not become one', () => {
    cfg.clientThrows = true
    expect(() => reportServerError('presign', 'boom')).not.toThrow()
  })
})

describe('reportServerThrow', () => {
  it('records the error name and message, and a non-Error as its string', async () => {
    reportServerThrow('webhook', new TypeError('cannot read tier'))
    reportServerThrow('webhook', 'plain failure')
    await Promise.all(waited)
    expect(rpcs.map((r) => r.args.p_message)).toEqual(['TypeError: cannot read tier', 'plain failure'])
  })
})
