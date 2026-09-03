import { describe, it, expect, vi, beforeEach } from 'vitest'

// THE ROUTE THAT DECIDES WHETHER AN OWNER KEEPS THE ONLY KEY TO THEIR ALBUM.
//
// "Your albums on this device" reads slugs and owner tokens out of localStorage and asks this route
// which ones are still real, so a stale entry can be pruned. Pruning calls forgetAlbum(), which
// throws the OWNER TOKEN away — and for an album made without an account that token is the only
// proof of ownership that exists anywhere. 71 of the 105 live albums are in that position.
//
// So the classification here is not cosmetic. Getting it wrong in one direction leaves dead albums
// cluttering the list; getting it wrong in the other destroys the ability to ever recover a live
// one. When deleting became a soft delete, a binned album stopped being "alive" — and this route
// would have told the device to forget it within seconds of the owner deleting it, taking the token
// that the restore route authenticates with.

const rows: Array<{
  slug: string; custom_slug: string | null; user_id: string | null
  retired_at: string | null; deleted_at: string | null
}> = []
let queryError: string | null = null

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.or = () => chain
      chain.is = () => chain
      chain.returns = async () => (queryError
        ? { data: null, error: { message: queryError } }
        : { data: rows, error: null })
      return chain
    },
  }),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ ok: true }),
  clientIpKey: (_r: unknown, p: string) => `${p}:test`,
}))

const { POST } = await import('@/app/api/album/exists/route')

const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString()

function ask(slugs: string[]) {
  return POST(new Request('https://hushare.space/api/album/exists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://hushare.space' },
    body: JSON.stringify({ slugs }),
  }))
}

type Answer = { alive: string[]; unclaimed: string[]; binned: string[] }

beforeEach(() => {
  rows.length = 0
  queryError = null
})

describe('a live album is alive', () => {
  it('reports it, and reports it unclaimed when it has no account', async () => {
    rows.push({ slug: 'abc12345', custom_slug: null, user_id: null, retired_at: null, deleted_at: null })
    const a = await (await ask(['abc12345'])).json() as Answer
    expect(a.alive).toEqual(['abc12345'])
    expect(a.unclaimed).toEqual(['abc12345'])
    expect(a.binned).toEqual([])
  })

  it('does not call an album with an account unclaimed', async () => {
    rows.push({ slug: 'abc12345', custom_slug: null, user_id: 'user-1', retired_at: null, deleted_at: null })
    const a = await (await ask(['abc12345'])).json() as Answer
    expect(a.alive).toEqual(['abc12345'])
    expect(a.unclaimed).toEqual([])
  })
})

describe('a DELETED album is neither alive nor dead', () => {
  it('is reported as binned, so the device keeps its token', async () => {
    // THE ASSERTION THAT PROTECTS THE KEY. If this album is missing from every list, the device
    // prunes it and the owner token is gone — and with it any way to restore an anonymous album.
    rows.push({ slug: 'abc12345', custom_slug: null, user_id: null, retired_at: ago(1), deleted_at: ago(1) })
    const a = await (await ask(['abc12345'])).json() as Answer
    expect(a.binned, 'the device must be told to keep this one').toEqual(['abc12345'])
    expect(a.alive, 'but it is genuinely hidden — not alive').toEqual([])
  })

  it('is not offered for claiming while it is in the bin', async () => {
    rows.push({ slug: 'abc12345', custom_slug: null, user_id: null, retired_at: ago(1), deleted_at: ago(1) })
    const a = await (await ask(['abc12345'])).json() as Answer
    expect(a.unclaimed).toEqual([])
  })

  it('stops being binned once the window has closed', async () => {
    // Past the window the album is really going, so the device should prune it and stop offering a
    // restore that would fail.
    rows.push({ slug: 'abc12345', custom_slug: null, user_id: null, retired_at: ago(9), deleted_at: ago(9) })
    const a = await (await ask(['abc12345'])).json() as Answer
    expect(a.binned).toEqual([])
    expect(a.alive).toEqual([])
  })
})

describe('an album retired for INACTIVITY is simply gone', () => {
  it('is neither alive nor binned, so the device prunes it', async () => {
    // Retention retirement is not the bin: nobody asked to delete it, it was warned about for 30
    // days, and there is nothing to restore. Reporting it binned would offer a button that fails.
    rows.push({ slug: 'abc12345', custom_slug: null, user_id: null, retired_at: ago(2), deleted_at: null })
    const a = await (await ask(['abc12345'])).json() as Answer
    expect(a.alive).toEqual([])
    expect(a.binned).toEqual([])
  })
})

describe('a failure never costs anybody their token', () => {
  it('reports everything alive when the lookup fails', async () => {
    // Pruning on an error would delete the owner's only record of a LIVE album. Errs toward doing
    // nothing (rule 19).
    queryError = 'connection reset'
    const a = await (await ask(['abc12345', 'def67890'])).json() as Answer
    expect(a.alive).toEqual(['abc12345', 'def67890'])
    expect(a.unclaimed).toEqual([])
    expect(a.binned).toEqual([])
  })

  it('an album the database does not know about is not claimed to be binned', async () => {
    const a = await (await ask(['abc12345'])).json() as Answer
    expect(a.alive).toEqual([])
    expect(a.binned).toEqual([])
  })
})
