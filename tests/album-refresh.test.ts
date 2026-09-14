import { describe, it, expect } from 'vitest'
import { refreshAlbum, type RefreshDeps, type SinceAnswer, type PhotoPage } from '@/lib/album-refresh'
import type { AlbumFreshness } from '@/lib/album-freshness'

// ONE REQUEST PER LIVE REFRESH.
//
// A refresh was a probe and then a fetch -- two requests on nearly every check during an event, while
// the capacity arithmetic in tests/event-capacity counted one. These count the requests each kind of
// refresh actually makes, and pin what must not change on the way: a failed answer never skips the
// window, a short delta is never trusted, and freshness is remembered only from a fetch that succeeded.

type Row = { id: string; created_at: string }
const A = '2026-09-19T08:00:00Z'
const B = '2026-09-19T08:00:05Z'
const rowsOf = (n: number, at = B): Row[] => Array.from({ length: n }, (_, i) => ({ id: `new-${i}`, created_at: at }))
const HELD: AlbumFreshness = { total: 4567, latest: A }

function rig(o: {
  seen: AlbumFreshness | null
  since?: SinceAnswer<Row> | null
  probe?: AlbumFreshness | null
  window?: PhotoPage<Row> | null
}) {
  let seen = o.seen
  const requests: string[] = []
  const deltas: PhotoPage<Row>[] = []
  const windows: Array<PhotoPage<Row> | null> = []
  const deps: RefreshDeps<Row> = {
    seen: () => seen,
    remember: (f) => { seen = f },
    probe: async () => { requests.push('probe'); return o.probe ?? null },
    since: async (since, limit) => { requests.push(`since ${since} limit ${limit}`); return o.since ?? null },
    window: async () => { requests.push('window'); return o.window === undefined ? { photos: rowsOf(3), total: 3 } : o.window },
    applyDelta: (p) => { deltas.push(p) },
    applyWindow: (p) => { windows.push(p) },
    maxDelta: 100,
  }
  return { deps, requests, deltas, windows, seen: () => seen }
}

describe('a viewer that knows what it holds', () => {
  it('AN UNCHANGED ALBUM COSTS ONE REQUEST and applies nothing', async () => {
    const r = rig({ seen: HELD, since: { photos: [], total: 4567, latest: A } })
    expect(await refreshAlbum(r.deps, { force: false })).toBe('unchanged')
    expect(r.requests).toEqual([`since ${A} limit 100`])
    expect(r.deltas).toEqual([])
    expect(r.windows).toEqual([])
  })

  it('THREE NEW PHOTOS COST ONE REQUEST: the rows came with the answer', async () => {
    const r = rig({ seen: HELD, since: { photos: rowsOf(3), total: 4570, latest: B } })
    expect(await refreshAlbum(r.deps, { force: false })).toBe('delta')
    expect(r.requests, 'no probe first, no second fetch').toHaveLength(1)
    expect(r.deltas[0].photos).toHaveLength(3)
    expect(r.seen()).toEqual({ total: 4570, latest: B })
  })

  it('a DELETION takes the window, and remembers the freshness the answer gave', async () => {
    const r = rig({ seen: HELD, since: { photos: [], total: 4566, latest: A } })
    expect(await refreshAlbum(r.deps, { force: false })).toBe('window')
    expect(r.requests).toEqual([`since ${A} limit 100`, 'window'])
    expect(r.seen()).toEqual({ total: 4566, latest: A })
  })

  it('a burst larger than a delta takes the window', async () => {
    const r = rig({ seen: HELD, since: { photos: rowsOf(100), total: 4567 + 150, latest: B } })
    expect(await refreshAlbum(r.deps, { force: false })).toBe('window')
  })

  it('a FORCED refresh with nothing moved -- a reorder -- still takes the window', async () => {
    const r = rig({ seen: HELD, since: { photos: [], total: 4567, latest: A } })
    expect(await refreshAlbum(r.deps, { force: true })).toBe('window')
    expect(r.requests).toHaveLength(2)
  })

  it('a SHORT delta is never trusted: a row this viewer just deleted, filtered out, takes the window', async () => {
    const r = rig({ seen: HELD, since: { photos: rowsOf(2), total: 4570, latest: B } })
    expect(await refreshAlbum(r.deps, { force: false })).toBe('window')
    expect(r.deltas).toEqual([])
  })

  it('a FAILED since read never skips: it takes the window, and remembers nothing', async () => {
    const r = rig({ seen: HELD, since: null })
    expect(await refreshAlbum(r.deps, { force: false })).toBe('window')
    expect(r.seen(), 'nothing answered, so nothing is known').toEqual(HELD)
  })

  it('a FAILED window is handed on as a failure, and remembers nothing', async () => {
    const r = rig({ seen: HELD, since: { photos: [], total: 4566, latest: A }, window: null })
    await refreshAlbum(r.deps, { force: false })
    expect(r.windows, 'the caller keeps what is on screen').toEqual([null])
    expect(r.seen(), 'or the next check would skip the retry').toEqual(HELD)
  })

  it('an answer with no newest time (a server from before this change) never produces a delta', async () => {
    const r = rig({ seen: HELD, since: { photos: rowsOf(3), total: 4570, latest: null } })
    expect(await refreshAlbum(r.deps, { force: false })).toBe('window')
  })
})

describe('a viewer that does not yet know what it holds', () => {
  it('asks the probe, and fetches the window only when the album moved', async () => {
    const moved = rig({ seen: null, probe: { total: 10, latest: B } })
    expect(await refreshAlbum(moved.deps, { force: false })).toBe('window')
    expect(moved.requests).toEqual(['probe', 'window'])
    expect(moved.seen()).toEqual({ total: 10, latest: B })
  })

  it('an empty album holds no newest time, so it probes -- and an unchanged one stops there', async () => {
    const r = rig({ seen: { total: 0, latest: null }, probe: { total: 0, latest: null } })
    expect(await refreshAlbum(r.deps, { force: false })).toBe('unchanged')
    expect(r.requests).toEqual(['probe'])
  })
})
