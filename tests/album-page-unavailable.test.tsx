import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactElement } from 'react'

// THE ALBUM PAGE NEVER ANSWERS A FAILED READ WITH A 404.
//
// The review of 2026-09-14 found resolveAlbum dropping the database error, so a gateway blip on the QR
// scan rendered "this album does not exist" -- the one answer a guest at the venue believes and acts
// on. The page now renders the client unseeded instead, which resolves the album itself and offers its
// "try again" screen if that fails too. Server components are plain async functions, so this calls
// the page and reads the tree it returns.

const state = {
  resolved: { kind: 'unavailable' } as Record<string, unknown>,
  notFoundCalls: 0,
}

vi.mock('next/navigation', () => ({
  notFound: () => { state.notFoundCalls++; throw new Error('NEXT_NOT_FOUND') },
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/server/album-access', () => ({
  resolveAlbum: async () => state.resolved,
  fetchAuthorizedPhotos: async () => ({ kind: 'ok', photos: [{ id: 'p1' }], total: 1 }),
}))
vi.mock('@/lib/analytics', () => ({ track: () => {} }))
vi.mock('@/lib/visitor-context', () => ({ getVisitorContext: async () => ({}) }))
vi.mock('@/components/EngagementBeacon', () => ({ default: () => null }))
vi.mock('@/i18n/server', () => ({ getServerLocale: async () => 'en' }))
vi.mock('@/i18n/get-dictionary', () => ({ getDictionary: () => ({}) }))
vi.mock('@/app/[slug]/AlbumPageClient', () => ({ default: function AlbumPageClient() { return null } }))

const { default: AlbumPage } = await import('@/app/[slug]/page')
const { default: AlbumPageClient } = await import('@/app/[slug]/AlbumPageClient')

const render = () => AlbumPage({ params: Promise.resolve({ slug: 'abcd1234' }), searchParams: Promise.resolve({}) })

function clientIn(tree: ReactElement): ReactElement<Record<string, unknown>> | undefined {
  const children = (tree.props as { children?: unknown }).children
  const list = (Array.isArray(children) ? children : [children]) as ReactElement[]
  return list.find((c) => c && c.type === AlbumPageClient) as ReactElement<Record<string, unknown>> | undefined
}

beforeEach(() => {
  state.resolved = { kind: 'unavailable' }
  state.notFoundCalls = 0
})

describe('the album page', () => {
  it('A FAILED READ RENDERS THE CLIENT UNSEEDED, never a 404', async () => {
    const tree = await render()
    expect(state.notFoundCalls).toBe(0)
    const client = clientIn(tree as ReactElement)
    expect(client, 'the album client is rendered, so it can resolve the album and offer a retry').toBeDefined()
    expect(client!.props).toEqual({})
  })

  it('an album that does not exist is still a 404', async () => {
    state.resolved = { kind: 'notfound' }
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(state.notFoundCalls).toBe(1)
  })

  it('an album that resolves is seeded with its photos, as before', async () => {
    state.resolved = { kind: 'album', album: { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', slug: 'abcd1234' } }
    const client = clientIn((await render()) as ReactElement)
    expect(client!.props).toMatchObject({ initialAlbum: { slug: 'abcd1234' }, initialPhotos: [{ id: 'p1' }], initialTotal: 1 })
  })
})
