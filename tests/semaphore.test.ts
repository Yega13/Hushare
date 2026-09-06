import { describe, it, expect } from 'vitest'
import { Semaphore } from '@/lib/upload/semaphore'

// THE UPLOAD LANE'S CONCURRENCY CONTROL, tested for the first time.
//
// This class gates every concurrent upload a guest makes -- images through decodeSem, videos
// through the adaptive lane that widens after clean uploads and collapses to one on any failure. It
// lived at module scope in UploadZone.tsx, correct and well-commented, with no `export` and so no
// test. Each case below is a property the comment above the class promises; several are the exact
// ways a semaphore quietly goes wrong (a waiter that never wakes, a lane that leaks slots).
//
// TWO OF THESE WERE REWRITTEN AFTER A MUTATION RUN. The first versions of the double-release and
// shrink-absorb tests passed against code with the guards deleted, because the OTHER guard masked the
// missing one: a double release that keeps `available` at or below capacity is never clamped, and a
// count that both implementations reach proves nothing. The scenarios below are the ones only the
// correct code passes.

/** Resolve only after the microtask queue drains, so a settled acquire has actually run. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe('a plain N-slot semaphore', () => {
  it('grants up to capacity immediately and queues the rest', async () => {
    const s = new Semaphore(2)
    let granted = 0
    void s.acquire().then(() => { granted++ })
    void s.acquire().then(() => { granted++ })
    void s.acquire().then(() => { granted++ })
    await tick()
    expect(granted).toBe(2)
  })

  it('release hands the slot to the next waiter', async () => {
    const s = new Semaphore(1)
    const release = await s.acquire()
    let second = false
    const p = s.acquire().then((r) => { second = true; r() })
    await tick()
    expect(second).toBe(false)
    release()
    await p
    expect(second).toBe(true)
  })

  it('a double release admits exactly ONE waiter, not two -- the lane cannot inflate', async () => {
    // Capacity 3, all three held, two waiters queued. Releasing one holder TWICE must admit one
    // waiter. Without the idempotence guard it admits both: available climbs to 2, which is under
    // the cap of 3, so the shrink-absorb clamp never fires and nothing else catches it. That is the
    // masking that let the first version of this test pass against broken code.
    const s = new Semaphore(3)
    const a = await s.acquire(); await s.acquire(); await s.acquire()
    let woke = 0
    void s.acquire().then(() => { woke++ })
    void s.acquire().then(() => { woke++ })
    await tick()
    expect(woke).toBe(0)
    a()
    a()
    await tick()
    expect(woke, 'a second release granted a slot that does not exist').toBe(1)
  })

  it('clamps a nonsense capacity to at least one', () => {
    expect(new Semaphore(0).capacity).toBe(1)
    expect(new Semaphore(-4).capacity).toBe(1)
    expect(new Semaphore(2.9).capacity).toBe(2)
  })
})

describe('weighted acquire', () => {
  it('a weight larger than the capacity clamps to the whole lane rather than waiting forever', async () => {
    // A 4 GB video asks for weight 10 on a lane of 3: it must take the whole lane, not queue for
    // ten slots that can never exist.
    const s = new Semaphore(3)
    const release = await s.acquire(10)
    let other = false
    void s.acquire().then(() => { other = true })
    await tick()
    expect(other, 'the heavy holder did not take the whole lane').toBe(false)
    release()
    await tick()
    expect(other).toBe(true)
  })

  it('is FIFO: a heavy waiter is not starved by light ones arriving after it', async () => {
    const s = new Semaphore(2)
    const r1 = await s.acquire(1)
    const order: string[] = []
    const heavy = s.acquire(2).then((r) => { order.push('heavy'); r() })
    const light = s.acquire(1).then((r) => { order.push('light'); r() })
    await tick()
    // One slot is free; the light waiter COULD run, but the heavy one is ahead of it in the queue.
    expect(order).toEqual([])
    r1()
    await Promise.all([heavy, light])
    expect(order[0], 'a later light waiter jumped the heavy one').toBe('heavy')
  })
})

describe('runtime capacity changes', () => {
  it('growing the lane wakes waiters immediately', async () => {
    const s = new Semaphore(1)
    const r1 = await s.acquire()
    let woke = false
    void s.acquire().then(() => { woke = true })
    await tick()
    expect(woke).toBe(false)
    s.setCapacity(2)
    await tick()
    expect(woke, 'setCapacity grew but nobody was woken').toBe(true)
    r1()
  })

  it('shrinking re-clamps a queued heavy waiter so it cannot wait forever', async () => {
    // The lane collapses from 3 to 1 on a failure while a weight-3 request is queued. Left at
    // weight 3 it would wait for slots that will never exist again. It must be re-clamped to 1.
    const s = new Semaphore(3)
    const r = await s.acquire(3)
    let granted = false
    void s.acquire(3).then((rel) => { granted = true; rel() })
    s.setCapacity(1)
    r()
    await tick()
    expect(granted, 'a queued waiter outlived the shrink and hung').toBe(true)
  })

  it('after a shrink, releasing the retired holders does NOT let the lane grow back past the new cap', async () => {
    // Capacity 3, all three held, then the lane collapses to 1 on a failure. As the three retired
    // holders finish, each release must be absorbed -- the lane is 1 now. Then three fresh acquires
    // with NO releases in between: exactly one may hold. Without the absorb clamp `available` climbs
    // back to 3 and all three are granted -- the collapse-to-one that protects a struggling network
    // silently undone by the uploads that triggered it.
    const s = new Semaphore(3)
    const a = await s.acquire(); const b = await s.acquire(); const c = await s.acquire()
    s.setCapacity(1)
    a(); b(); c()
    let holding = 0
    void s.acquire().then(() => { holding++ })
    void s.acquire().then(() => { holding++ })
    void s.acquire().then(() => { holding++ })
    await tick()
    expect(holding, 'retired slots leaked back into a lane that had collapsed to 1').toBe(1)
  })

  it('shrinking never revokes an in-flight holder', async () => {
    const s = new Semaphore(3)
    const a = await s.acquire(); const b = await s.acquire(); const c = await s.acquire()
    s.setCapacity(1)
    expect(s.capacity).toBe(1)
    // Nothing was torn down: all three release functions are still live and still hand off.
    let d = false
    void s.acquire().then((rel) => { d = true; rel() })
    a(); await tick()
    expect(d, 'one release on a lane of 1 should admit the next').toBe(true)
    b(); c()
  })
})
