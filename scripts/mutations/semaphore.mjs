// Mutation set for src/lib/upload/semaphore.ts -- run with: node scripts/mutations/run.mjs semaphore
// Each entry is a change that would make the code WRONG; the tests in tests/semaphore.test.ts must fail on it.
export default {
  file: 'src/lib/upload/semaphore.ts',
  test: 'tests/semaphore.test.ts',
  mutations: [
  { name: 'double release inflates the lane (idempotence guard removed)',
    from: '      if (released) return\n      released = true\n', to: '' },
  { name: 'a weight above capacity is NOT clamped (waits forever)',
    from: '    const w = Math.min(Math.max(1, Math.floor(weight)), this.cap)',
    to:   '    const w = Math.max(1, Math.floor(weight))' },
  { name: 'FIFO broken: a light waiter can jump the queue',
    from: '    if (this.queue.length === 0 && this.available >= w) {',
    to:   '    if (this.available >= w) {' },
  { name: 'shrink does not re-clamp queued waiters (the forever-wait)',
    from: '      for (const item of this.queue) if (item.w > this.cap) item.w = this.cap\n', to: '' },
  { name: 'grow does not wake waiters',
    from: '    } else if (delta > 0) {\n      this.available += delta\n    }\n    this.drain()',
    to:   '    } else if (delta > 0) {\n      this.available += delta\n    }' },
  { name: 'release does not absorb slots retired by a shrink (lane leaks upward)',
    from: '      if (this.available > this.cap) this.available = this.cap // absorb slots retired by a shrink\n', to: '' },
  { name: 'constructor does not clamp to >= 1',
    from: '  constructor(capacity: number) { this.cap = Math.max(1, Math.floor(capacity)); this.available = this.cap }',
    to:   '  constructor(capacity: number) { this.cap = Math.floor(capacity); this.available = this.cap }' },
  ],
}
