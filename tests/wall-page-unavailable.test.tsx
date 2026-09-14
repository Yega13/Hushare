import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'

// THE LIVE WALL NEVER ANSWERS A FAILED READ WITH A 404.
//
// The wall runs on a projector at the venue. A database blip used to resolve as "not found", so the
// screen everyone is watching showed a 404 for an album that exists. It now says to reload.

const state = { resolved: { kind: 'unavailable' } as Record<string, unknown>, notFoundCalls: 0 }

vi.mock('next/navigation', () => ({
  notFound: () => { state.notFoundCalls++; throw new Error('NEXT_NOT_FOUND') },
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/server/album-access', () => ({
  resolveAlbum: async () => state.resolved,
  fetchAuthorizedPhotos: async () => ({ kind: 'ok', photos: [], total: 0 }),
}))
vi.mock('@/lib/require-tier', () => ({ albumHasTier: async () => true }))
vi.mock('@/components/PhotoWall', () => ({ default: () => null }))

const { default: WallPage } = await import('@/app/wall/[slug]/page')

/** Every string rendered anywhere in a returned element tree. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  const props = (node as { props?: { children?: ReactNode } }).props
  return props ? textOf(props.children) : ''
}

beforeEach(() => {
  state.resolved = { kind: 'unavailable' }
  state.notFoundCalls = 0
})

describe('the live wall', () => {
  it('A FAILED READ SAYS TO RELOAD, never a 404', async () => {
    const tree = await WallPage({ params: Promise.resolve({ slug: 'abcd1234' }) })
    expect(state.notFoundCalls).toBe(0)
    expect(textOf(tree)).toContain('The wall could not load')
  })

  it('an album that does not exist is still a 404', async () => {
    state.resolved = { kind: 'notfound' }
    await expect(WallPage({ params: Promise.resolve({ slug: 'abcd1234' }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
