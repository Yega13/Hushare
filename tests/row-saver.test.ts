import { describe, it, expect, vi } from 'vitest'
import { REFUSED_SESSION_MESSAGE, SAVE_DEBOUNCE_MS, createRowSaver, partitionRefused } from '@/lib/upload/row-saver'
import type { Timers } from '@/lib/settings-sync'

// WRITING THE ROWS. A photo exists in two places -- bytes in R2, a row in the database -- and
// everything that can go wrong between them is decided here. Timers are fake, so "one request per
// batch" and "serial" are assertions rather than hopes.

function fakeTimers() {
  let seq = 0
  const live = new Map<number, { fn: () => void; ms: number }>()
  const timers: Timers = {
    set(fn, ms) { const id = ++seq; live.set(id, { fn, ms }); return id },
    clear(id) { live.delete(id) },
  }
  const fire = () => { const fns = [...live.values()].map((t) => t.fn); live.clear(); fns.forEach((f) => f()) }
  return { timers, fire, pending: () => live.size, delays: () => [...live.values()].map((t) => t.ms) }
}

type Row = { storage_path: string; stream_uid?: string | null }
const row = (p: string, uid?: string): Row => ({ storage_path: p, stream_uid: uid ?? null })

function rig(save: (rows: Row[]) => Promise<{ warning?: string; rejected?: string[] }>) {
  const t = fakeTimers()
  const saved: string[][] = []
  const failed: Array<{ ids: string[]; message: string; rows?: Row[]; code?: string; nudge?: string }> = []
  const warnings: string[] = []
  const saver = createRowSaver<Row>({
    save,
    onSaved: (ids) => saved.push(ids),
    onFailed: (ids, message, code, rows, nudge) => failed.push({ ids, message, code, rows, nudge }),
    onWarning: (m) => warnings.push(m),
    timers: t.timers,
  })
  return { ...t, saver, saved, failed, warnings }
}

describe('partitionRefused -- what the server actually wrote', () => {
  const batch = [{ row: row('a.jpg') }, { row: row('b.mp4', 'uid-b') }, { row: row('c.mp4', 'uid-c') }]
  it('no rejected list means everything landed', () => {
    expect(partitionRefused(batch, undefined).saved).toBe(batch)
    expect(partitionRefused(batch, []).lost).toEqual([])
  })
  it('a refused uid is lost and the rest are saved', () => {
    const r = partitionRefused(batch, ['uid-b'])
    expect(r.lost.map((b) => b.row.storage_path)).toEqual(['b.mp4'])
    expect(r.saved.map((b) => b.row.storage_path)).toEqual(['a.jpg', 'c.mp4'])
  })
  it('a row with no upload session can never be refused this way', () => {
    // The refusal is about a spent Stream token; an image has none, so a uid that matches nothing
    // in the batch must not silently take a photo out of the saved list.
    expect(partitionRefused(batch, ['uid-nothing']).saved).toBe(batch)
  })
})

describe('createRowSaver -- one request per batch, in order', () => {
  it('fifty photos finishing together are ONE save, after the debounce', async () => {
    const save = vi.fn(async (_rows: Row[]) => ({}))
    const r = rig(save)
    for (let i = 0; i < 50; i++) r.saver.add(row(`p${i}.jpg`), `e${i}`)
    expect(save).not.toHaveBeenCalled()
    expect(r.pending()).toBe(1)
    expect(r.delays()).toEqual([SAVE_DEBOUNCE_MS])
    r.fire()
    await r.saver.finish()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0]).toHaveLength(50)
    expect(r.saved[0]).toHaveLength(50)
  })

  it('finish flushes without waiting for the timer, and clears it', async () => {
    const save = vi.fn(async () => ({}))
    const r = rig(save)
    r.saver.add(row('a.jpg'), 'e1')
    expect(await r.saver.finish()).toBe(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(r.pending(), 'the debounce timer is gone, so it cannot fire an empty second save').toBe(0)
  })

  it('finish with nothing queued saves nothing', async () => {
    const save = vi.fn(async () => ({}))
    const r = rig(save)
    expect(await r.saver.finish()).toBe(0)
    expect(save).not.toHaveBeenCalled()
  })

  it('saves are SERIAL: a second batch waits for the first to settle', async () => {
    const order: string[] = []
    let releaseFirst: () => void = () => {}
    const save = vi.fn((rows: Row[]) => {
      order.push(`start:${rows[0].storage_path}`)
      if (rows[0].storage_path === 'a.jpg') return new Promise<{ rejected?: string[] }>((res) => { releaseFirst = () => { order.push('end:a.jpg'); res({}) } })
      order.push(`end:${rows[0].storage_path}`)
      return Promise.resolve({})
    })
    const r = rig(save)
    r.saver.add(row('a.jpg'), 'e1'); r.fire()
    r.saver.add(row('b.jpg'), 'e2'); r.fire()
    await Promise.resolve()
    expect(order).toEqual(['start:a.jpg'])
    releaseFirst()
    await r.saver.finish()
    expect(order).toEqual(['start:a.jpg', 'end:a.jpg', 'start:b.jpg', 'end:b.jpg'])
  })

  it('a video the server REFUSED is not ticked green, and gets NO rows back', async () => {
    // A refused uid has a spent upload token: re-saving is refused forever, so it must reach the
    // tile's Retry (a fresh upload) and never the "finish saving" queue.
    const r = rig(async () => ({ rejected: ['uid-b'] }))
    r.saver.add(row('a.jpg'), 'e1')
    r.saver.add(row('b.mp4', 'uid-b'), 'e2')
    expect(await r.saver.finish()).toBe(1)
    expect(r.saved).toEqual([['e1']])
    expect(r.failed).toEqual([{ ids: ['e2'], message: REFUSED_SESSION_MESSAGE, code: undefined, rows: undefined, nudge: undefined }])
  })

  it('a thrown save hands EVERY row back with its code and nudge, so they can be re-saved', async () => {
    // Dropping them cost people photos they had already uploaded: the bytes sit in R2 with no row
    // and nothing server-side reconciles orphans.
    const r = rig(async () => { throw Object.assign(new Error('Album is full'), { code: 'album_full', nudge: 'register' }) })
    r.saver.add(row('a.jpg'), 'e1')
    r.saver.add(row('b.jpg'), 'e2')
    expect(await r.saver.finish()).toBe(0)
    expect(r.saved).toEqual([])
    expect(r.failed[0].ids).toEqual(['e1', 'e2'])
    expect(r.failed[0].message).toBe('Album is full')
    expect(r.failed[0].code).toBe('album_full')
    expect(r.failed[0].nudge).toBe('register')
    expect(r.failed[0].rows?.map((x) => x.storage_path)).toEqual(['a.jpg', 'b.jpg'])
  })

  it('a throw in one batch does not stop the next one', async () => {
    let first = true
    const r = rig(async () => { if (first) { first = false; throw new Error('blip') } return {} })
    r.saver.add(row('a.jpg'), 'e1'); r.fire()
    r.saver.add(row('b.jpg'), 'e2')
    expect(await r.saver.finish()).toBe(1)
    expect(r.saved).toEqual([['e2']])
  })

  it('the over-limit warning is shown ONCE per session, not once per batch', async () => {
    const r = rig(async () => ({ warning: 'You are over your plan limit' }))
    r.saver.add(row('a.jpg'), 'e1'); r.fire()
    await Promise.resolve()
    r.saver.add(row('b.jpg'), 'e2')
    await r.saver.finish()
    expect(r.warnings).toEqual(['You are over your plan limit'])
  })

  it('the saved count is what the SERVER took, not what was queued', async () => {
    const r = rig(async () => ({ rejected: ['uid-b'] }))
    r.saver.add(row('a.jpg'), 'e1')
    r.saver.add(row('b.mp4', 'uid-b'), 'e2')
    r.saver.add(row('c.jpg'), 'e3')
    expect(await r.saver.finish()).toBe(2)
  })
})
