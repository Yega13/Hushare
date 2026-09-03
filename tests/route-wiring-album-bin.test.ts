import { describe, it, expect, vi, beforeEach } from 'vitest'

// DELETING AN ALBUM, WHICH IS THE ONE ACTION WITH NO UNDO AND NO BACKUP.
//
// This used to destroy every R2 object, every Stream video and the row in a single request. Anyone
// holding the owner link could do it, and on an album made without an account the owner link is the
// ONLY proof of ownership — so that is everyone it was ever shared with, including people who were
// only meant to help manage it.
//
// What is asserted here is the WIRING: that delete marks and does not destroy, that the mark hides
// the album through the filter every other route already applies, and that restore is the one door
// left open. The window arithmetic belongs to lib/album-bin and is tested there.

const ALBUM_ID = 'album-1'
const TOKEN = 'owner-token-value'

const state: {
  album: { id: string; owner_token: string; deleted_at: string | null } | null
  ownerCookie: string | null
  updates: Array<Record<string, unknown>>
  filters: Array<Record<string, unknown>>
  updateError: string | null
  restoredRows: Array<{ id: string }>
  destroyed: string[]
  signedInUser: { id: string } | null
  /** Filters applied AFTER .update() — the ones that scope the write. */
  updateFilters: Array<Record<string, unknown>>
} = {
  album: null, ownerCookie: null, updates: [], filters: [], updateError: null,
  restoredRows: [{ id: ALBUM_ID }], destroyed: [], signedInUser: { id: 'user-1' },
  updateFilters: [],
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      // `select` is chainable on a READ and terminal after an UPDATE (`.update(...).select('id')`),
      // so which one it is depends on whether update has been called on this builder.
      let updating = false
      chain.update = (row: Record<string, unknown>) => {
        updating = true
        state.updates.push(row)
        return chain
      }
      const record = (f: Record<string, unknown>) => {
        state.filters.push(f)
        // SEPARATELY, because the read and the write in these routes filter on the SAME columns.
        // A single list let an assertion about the UPDATE's scoping be satisfied by the SELECT's,
        // so dropping `.eq('user_id', …)` from the update — any signed-in user restoring anybody's
        // album — passed the test written to prevent exactly that.
        if (updating) state.updateFilters.push(f)
      }
      chain.eq = (col: string, val: unknown) => { record({ [`eq:${col}`]: val }); return chain }
      chain.is = (col: string, val: unknown) => { record({ [`is:${col}`]: val }); return chain }
      chain.not = (col: string, op: string, val: unknown) => {
        record({ [`not:${col}`]: `${op} ${String(val)}` })
        return chain
      }
      chain.select = () => (updating
        ? Promise.resolve({
            data: state.restoredRows,
            error: state.updateError ? { message: state.updateError } : null,
          })
        : chain)
      chain.maybeSingle = async () => ({
        data: state.album ? { ...state.album, user_id: 'user-1' } : null,
        error: null,
      })
      // The delete paths await the builder itself rather than calling .select().
      chain.then = (res: (v: unknown) => unknown) =>
        res({ error: state.updateError ? { message: state.updateError } : null })
      return chain
    },
  }),
}))

// THE DESTRUCTIVE FUNCTION, RECORDED. If delete ever calls it again, these tests fail — which is the
// single most important assertion in this file.
vi.mock('@/lib/album-delete', () => ({
  deleteAlbumAssetsAndRows: async (_a: unknown, album: { id: string }) => {
    state.destroyed.push(album.id)
    return { ok: true }
  },
}))

vi.mock('@/lib/album-owner-access', () => ({
  verifyOwnerViaCookieWithRateLimit: async () => (state.album
    ? {
        ok: true,
        album: {
          ...state.album,
          background_theme: null, logo_url: null, header_image: null, sponsor_logos: null,
        },
      }
    : { ok: false, error: 'Album not found', status: 404 }),
  lookupAlbumIncludingBinned: async () => state.album,
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) =>
      (state.ownerCookie && n === `hushare_owner_${ALBUM_ID}` ? { value: state.ownerCookie } : undefined),
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.signedInUser } }) } }),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ ok: true }),
  clientIpKey: (_r: unknown, p: string) => `${p}:test`,
}))

const { POST: DELETE_ALBUM } = await import('@/app/api/album/delete/route')
const { POST: RESTORE, GET: BIN_STATUS } = await import('@/app/api/album/restore/route')
const { POST: ACCOUNT_DELETE } = await import('@/app/api/account/albums/delete/route')
const { POST: ACCOUNT_RESTORE } = await import('@/app/api/account/albums/restore/route')

const post = (url: string, body: unknown) => new Request(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://hushare.space' },
  body: JSON.stringify(body),
})

const del = () => DELETE_ALBUM(post('https://hushare.space/api/album/delete', { slug: 'abc12345' }))
const restore = () => RESTORE(post('https://hushare.space/api/album/restore', { slug: 'abc12345' }))
const binnedDaysAgo = (days: number) => {
  state.album = {
    id: ALBUM_ID,
    owner_token: TOKEN,
    deleted_at: new Date(Date.now() - days * 86400_000).toISOString(),
  }
}

beforeEach(() => {
  state.album = { id: ALBUM_ID, owner_token: TOKEN, deleted_at: null }
  state.ownerCookie = TOKEN
  state.updates = []
  state.filters = []
  state.updateError = null
  state.restoredRows = [{ id: ALBUM_ID }]
  state.destroyed = []
  state.signedInUser = { id: 'user-1' }
  state.updateFilters = []
})

describe('deleting marks the album, it does not destroy it', () => {
  it('destroys NOTHING', async () => {
    // The assertion this whole feature exists for.
    await del()
    expect(state.destroyed, 'no file may be touched until the bin window has passed').toEqual([])
  })

  it('sets deleted_at AND retired_at in one write', async () => {
    // retired_at is what actually hides it: the guest resolver and every owner mutation already
    // filter it at SQL level, so the album vanishes through paths that already exist and are
    // already tested. Writing the two separately would allow a moment in which the album is
    // recorded as deleted and still being served.
    await del()
    expect(state.updates).toHaveLength(1)
    const u = state.updates[0]
    expect(u.deleted_at, 'when it was deleted').toBeTruthy()
    expect(u.retired_at, 'without this the album is still public').toBeTruthy()
    expect(u.deleted_at).toBe(u.retired_at)
  })

  it('will not restart the clock on a second delete', async () => {
    // A double-click must not silently extend how long we store it.
    await del()
    expect(state.filters).toContainEqual({ 'is:deleted_at': null })
  })

  it('tells the owner how long they have', async () => {
    const body = await (await del()).json() as { ok: boolean; restorableForDays: number; message: string }
    expect(body.ok).toBe(true)
    expect(body.restorableForDays).toBe(7)
    expect(body.message).toContain('restore')
  })

  it('reports a failed write instead of claiming success', async () => {
    // Answering ok:true on a failed mark is the worst outcome available: the owner believes the
    // album is gone and it is still public.
    state.updateError = 'connection reset'
    expect((await del()).status).toBe(500)
  })
})

describe('restoring is the one door left open', () => {
  it('puts the album back, clearing BOTH columns', async () => {
    binnedDaysAgo(2)
    expect((await restore()).status).toBe(200)
    expect(state.updates[0]).toMatchObject({ deleted_at: null, retired_at: null })
  })

  it('refuses without the owner cookie', async () => {
    binnedDaysAgo(2)
    state.ownerCookie = null
    expect((await restore()).status).toBe(404)
    expect(state.updates, 'nothing may be written for a request that proved nothing').toEqual([])
  })

  it('refuses a WRONG owner cookie', async () => {
    binnedDaysAgo(2)
    state.ownerCookie = 'not-the-token'
    expect((await restore()).status).toBe(404)
    expect(state.updates).toEqual([])
  })

  it('refuses once the window has passed', async () => {
    binnedDaysAgo(8)
    expect((await restore()).status).toBe(404)
    expect(state.updates).toEqual([])
  })

  it('gives the same 404 for an album that was never deleted', async () => {
    // Same answer for every failure. This route reads rows the rest of the app refuses to read, so
    // it must not become a way to find out which slugs exist.
    expect((await restore()).status).toBe(404)
  })

  it('only writes to a row still in the bin', async () => {
    binnedDaysAgo(2)
    await restore()
    expect(state.filters).toContainEqual({ 'not:deleted_at': 'is null' })
  })

  it('treats losing the race as success', async () => {
    binnedDaysAgo(2)
    state.restoredRows = []
    const res = await restore()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, alreadyRestored: true })
  })
})

describe('the owner can ask whether their album is recoverable', () => {
  it('reports the days left to the owner', async () => {
    binnedDaysAgo(2)
    const res = await BIN_STATUS(new Request('https://hushare.space/api/album/restore?slug=abc12345'))
    expect(await res.json()).toMatchObject({ inBin: true, daysLeft: 5 })
  })

  it('tells a stranger nothing', async () => {
    binnedDaysAgo(1)
    state.ownerCookie = null
    const res = await BIN_STATUS(new Request('https://hushare.space/api/album/restore?slug=abc12345'))
    expect(await res.json()).toMatchObject({ inBin: false })
  })
})

describe('the SECOND delete button uses the same bin', () => {
  // There are two ways an owner can delete an album — the toolbar on the album, and the account
  // page — and only the first one learned about the bin. For a while, WHICH BUTTON YOU PRESSED
  // decided whether your photos still existed. That is the shape rule 13 exists to prevent.
  const UUID = '11111111-2222-3333-4444-555555555555'
  const accountDel = () => ACCOUNT_DELETE(post('https://hushare.space/api/account/albums/delete', { album_id: UUID }))

  it('destroys NOTHING', async () => {
    await accountDel()
    expect(state.destroyed).toEqual([])
  })

  it('marks it exactly as the toolbar does', async () => {
    await accountDel()
    expect(state.updates).toHaveLength(1)
    const u = state.updates[0]
    expect(u.deleted_at).toBeTruthy()
    expect(u.retired_at, 'without this the album is still public').toBe(u.deleted_at)
  })

  it('will not restart the clock, and stays scoped to the signed-in account', async () => {
    await accountDel()
    expect(state.filters).toContainEqual({ 'is:deleted_at': null })
    expect(state.filters).toContainEqual({ 'eq:user_id': 'user-1' })
  })

  it('refuses when nobody is signed in', async () => {
    state.signedInUser = null
    expect((await accountDel()).status).toBe(401)
    expect(state.updates).toEqual([])
  })

  it('reports a failed write instead of claiming success', async () => {
    // The owner believes the album is gone; it is still public. Worse than failing loudly.
    state.updateError = 'connection reset'
    expect((await accountDel()).status).toBe(500)
  })

  it('scopes the WRITE to the signed-in account', async () => {
    await accountDel()
    expect(state.updateFilters).toContainEqual({ 'eq:user_id': 'user-1' })
  })
})

describe('restoring from the account page', () => {
  const UUID = '11111111-2222-3333-4444-555555555555'
  const accountRestore = () => ACCOUNT_RESTORE(post('https://hushare.space/api/account/albums/restore', { album_id: UUID }))
  const binnedDays = (d: number) => {
    state.album = { id: ALBUM_ID, owner_token: TOKEN, deleted_at: new Date(Date.now() - d * 86400_000).toISOString() }
  }

  it('puts it back and clears both columns', async () => {
    binnedDays(3)
    expect((await accountRestore()).status).toBe(200)
    expect(state.updates[0]).toMatchObject({ deleted_at: null, retired_at: null })
  })

  it('is scoped to the account that owns it, on the WRITE', async () => {
    // A signed-in stranger guessing a UUID must not restore somebody else's album. Asserted against
    // the UPDATE's own filters: the lookup above scopes by user_id too, so a single list of filters
    // let this pass with the scoping removed from the write.
    binnedDays(3)
    await accountRestore()
    expect(state.updateFilters).toContainEqual({ 'eq:user_id': 'user-1' })
  })

  it('says plainly that the window has closed rather than pretending', async () => {
    binnedDays(9)
    const res = await accountRestore()
    expect(res.status).toBe(410)
    expect(state.updates).toEqual([])
  })

  it('refuses when nobody is signed in', async () => {
    binnedDays(3)
    state.signedInUser = null
    expect((await accountRestore()).status).toBe(401)
    expect(state.updates).toEqual([])
  })

  it('only writes to a row still in the bin', async () => {
    binnedDays(3)
    await accountRestore()
    expect(state.filters).toContainEqual({ 'not:deleted_at': 'is null' })
  })
})
