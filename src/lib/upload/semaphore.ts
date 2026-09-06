// Weighted counting semaphore with a RUNTIME-adjustable capacity (for adaptive video concurrency).
//
// MOVED HERE FROM UploadZone.tsx, verbatim, so it can be tested. It sat at module scope in a
// 2,900-line component -- already pure, already separated, already commented -- and was unreachable
// from any test for exactly one reason: no `export` keyword and the wrong filename. AGENTS.md rule 14
// is about decisions hidden inside components; this one was hidden in plain sight.
//
//   • Default weight 1 = a plain N-slot semaphore. A caller can take a larger weight to hold several
//     slots at once (a big video takes the whole video lane and uploads alone; short clips overlap).
//   • acquire() resolves to a RELEASE FUNCTION that returns EXACTLY the weight it took -- so capacity
//     can grow/shrink mid-flight with zero accounting drift, and a double-release is a no-op.
//   • FIFO: a heavy waiter can't be starved by a stream of light ones jumping the queue.
//   • setCapacity() grows (frees slots + wakes waiters) or shrinks (never revokes an in-flight
//     holder -- it just caps future grants, so the lane settles to the new size as holders finish).
export class Semaphore {
  private available: number
  private cap: number
  private queue: { w: number; resolve: (release: () => void) => void }[] = []
  constructor(capacity: number) { this.cap = Math.max(1, Math.floor(capacity)); this.available = this.cap }
  get capacity(): number { return this.cap }

  acquire(weight = 1): Promise<() => void> {
    const w = Math.min(Math.max(1, Math.floor(weight)), this.cap)
    if (this.queue.length === 0 && this.available >= w) {
      this.available -= w
      return Promise.resolve(this.makeRelease(w))
    }
    return new Promise<() => void>(resolve => this.queue.push({ w, resolve }))
  }

  setCapacity(next: number): void {
    const target = Math.max(1, Math.floor(next))
    const delta = target - this.cap
    this.cap = target
    if (delta < 0) {
      if (this.available > this.cap) this.available = this.cap
      // A shrink must never leave a queued waiter needing more slots than the lane now has -- it
      // would wait forever. Re-clamp to the new capacity (still correct: that weight already means
      // "the whole lane" at this size).
      for (const item of this.queue) if (item.w > this.cap) item.w = this.cap
    } else if (delta > 0) {
      this.available += delta
    }
    this.drain()
  }

  private makeRelease(w: number): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.available += w
      if (this.available > this.cap) this.available = this.cap // absorb slots retired by a shrink
      this.drain()
    }
  }

  private drain(): void {
    while (this.queue.length > 0 && this.available >= this.queue[0].w) {
      const next = this.queue.shift()!
      this.available -= next.w
      next.resolve(this.makeRelease(next.w))
    }
  }
}
