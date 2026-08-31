import { describe, it, expect } from 'vitest'
import { attachAlbumOwners } from '../src/lib/server/error-attribution'
import type { SupabaseClient } from '@supabase/supabase-js'

// A stand-in for the one query this module makes: admin.from('albums').select(...).in(...)
function fakeAdmin(
  result: { data?: unknown[]; error?: unknown },
  spy?: { ids?: string[]; lookedUp?: string[] },
  users: Record<string, string> = {},
) {
  return {
    auth: { admin: { getUserById: async (id: string) => {
      if (spy) (spy.lookedUp ??= []).push(id)
      return { data: users[id] ? { user: { email: users[id] } } : { user: null } }
    } } },
    from: () => ({
      select: () => ({
        in: (_col: string, ids: string[]) => {
          if (spy) spy.ids = ids
          return Promise.resolve(result)
        },
      }),
    }),
  } as unknown as SupabaseClient
}

const emails = new Map([['u1', 'owner@example.com']])

describe('attachAlbumOwners', () => {
  it('names the album and the owner to contact', async () => {
    const admin = fakeAdmin({ data: [{ id: 'a1', title: 'Race Day', slug: 'x1', custom_slug: 'race', user_id: 'u1' }] })
    const out = await attachAlbumOwners(admin, [{ album_id: 'a1' }], emails)
    expect(out[0].album).toEqual({ title: 'Race Day', slug: 'race', email: 'owner@example.com' })
  })

  it('prefers the custom URL, because that is the link that opens the album', async () => {
    const admin = fakeAdmin({ data: [{ id: 'a1', title: 'T', slug: 'raw', custom_slug: 'pretty', user_id: 'u1' }] })
    const out = await attachAlbumOwners(admin, [{ album_id: 'a1' }], emails)
    expect(out[0].album?.slug).toBe('pretty')
    const admin2 = fakeAdmin({ data: [{ id: 'a1', title: 'T', slug: 'raw', custom_slug: null, user_id: 'u1' }] })
    const out2 = await attachAlbumOwners(admin2, [{ album_id: 'a1' }], emails)
    expect(out2[0].album?.slug).toBe('raw')
  })

  it('distinguishes a guest album from a user we cannot resolve', async () => {
    // Two different truths that must not print the same way: nobody owns it, versus somebody
    // owns it and the lookup missed.
    const admin = fakeAdmin({ data: [
      { id: 'a1', title: 'Guest', slug: 's1', custom_slug: null, user_id: null },
      { id: 'a2', title: 'Orphan', slug: 's2', custom_slug: null, user_id: 'gone' },
    ] })
    const out = await attachAlbumOwners(admin, [{ album_id: 'a1' }, { album_id: 'a2' }], emails)
    expect(out[0].album?.email).toBe('(no account)')
    expect(out[1].album?.email).toBe('(unknown user)')
  })

  it('a report with no album, and one naming a deleted album, both resolve to null', async () => {
    const admin = fakeAdmin({ data: [] })
    const out = await attachAlbumOwners(admin, [{ album_id: null }, { album_id: 'deleted' }], emails)
    expect(out[0].album).toBeNull()
    expect(out[1].album).toBeNull()
    // The row itself must survive either way — the table is what you open when things are broken.
    expect(out).toHaveLength(2)
  })

  it('a failed lookup returns rows rather than throwing', async () => {
    const admin = fakeAdmin({ error: { message: 'boom' } })
    const out = await attachAlbumOwners(admin, [{ album_id: 'a1' }], emails)
    expect(out).toEqual([{ album_id: 'a1', album: null }])
  })

  it('an errored response is discarded even when it carries rows', async () => {
    // PostgREST can hand back BOTH an error and a partial body. The previous version of this
    // test only ever passed a body-less error, so removing the error check entirely left it
    // green — proving nothing about the guard it was named for (rule 16). A half-fetched result
    // would label genuinely-live albums "album deleted", so the whole result is discarded and
    // the next poll tries again.
    const admin = fakeAdmin({
      data: [{ id: 'a1', title: 'Half', slug: 's1', custom_slug: null, user_id: 'u1' }],
      error: { message: 'partial' },
    })
    const out = await attachAlbumOwners(admin, [{ album_id: 'a1' }], emails)
    expect(out[0].album).toBeNull()
  })

  it('makes no query at all when nothing names an album', async () => {
    const spy: { ids?: string[] } = {}
    const admin = fakeAdmin({ data: [] }, spy)
    await attachAlbumOwners(admin, [{ album_id: null }], emails)
    expect(spy.ids).toBeUndefined()
  })

  it('asks for each album once however many reports name it', async () => {
    const spy: { ids?: string[] } = {}
    const admin = fakeAdmin({ data: [] }, spy)
    await attachAlbumOwners(admin, [{ album_id: 'a1' }, { album_id: 'a1' }, { album_id: 'a2' }], emails)
    expect(spy.ids).toEqual(['a1', 'a2'])
  })

  it('looks up an owner the caller could not supply, once per user', async () => {
    // The live-stats poll carries no user map; listing every user every few seconds to label a
    // handful of rows would be absurd, so the few actually needed are fetched here.
    const spy: { lookedUp?: string[] } = {}
    const admin = fakeAdmin({ data: [
      { id: 'a1', title: 'A', slug: 's1', custom_slug: null, user_id: 'u9' },
      { id: 'a2', title: 'B', slug: 's2', custom_slug: null, user_id: 'u9' },
    ] }, spy, { u9: 'found@example.com' })
    const out = await attachAlbumOwners(admin, [{ album_id: 'a1' }, { album_id: 'a2' }], new Map())
    expect(out[0].album?.email).toBe('found@example.com')
    expect(spy.lookedUp).toEqual(['u9'])
  })

  it('does not look up an owner the caller already supplied', async () => {
    const spy: { lookedUp?: string[] } = {}
    const admin = fakeAdmin({ data: [{ id: 'a1', title: 'A', slug: 's1', custom_slug: null, user_id: 'u1' }] }, spy)
    const out = await attachAlbumOwners(admin, [{ album_id: 'a1' }], emails)
    expect(out[0].album?.email).toBe('owner@example.com')
    expect(spy.lookedUp).toBeUndefined()
  })

  it('preserves the row fields it was given', async () => {
    const admin = fakeAdmin({ data: [] })
    const out = await attachAlbumOwners(admin, [{ album_id: null, message: 'kept', level: 'error' }], emails)
    expect(out[0].message).toBe('kept')
    expect(out[0].level).toBe('error')
  })
})
