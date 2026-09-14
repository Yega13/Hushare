import { describe, it, expect, vi } from 'vitest'
import { readWithRetry, READ_RETRY_ATTEMPTS, READ_RETRY_DELAY_MS } from '@/lib/server/read-with-retry'

// ONE BLIP, ONE MORE ASK -- AND NEVER MORE THAN THAT.
//
// The error-alert cron filed 13 "Gateway Timeout" rows in 20 hours, each at :00 or :30, each alone.
// These pin the three things the fix is: a failed read is asked exactly once more, after a pause, with
// a freshly built query; a read that works is never delayed; an outage still comes back as a failure.
// Numbers are written as numbers (rule 17).

type Result = { data: string | null; error: { message: string } | null }
const ok = (data: string): Result => ({ data, error: null })
const fail = (message = 'Gateway Timeout'): Result => ({ data: null, error: { message } })

/** A read that answers from a script, one entry per attempt, and counts how often it was built. */
function scripted(...answers: Result[]) {
  let built = 0
  const read = vi.fn(() => {
    const answer = answers[Math.min(built, answers.length - 1)]
    built++
    return Promise.resolve(answer)
  })
  return { read, built: () => built }
}

describe('readWithRetry', () => {
  it('a read that works is returned at once, with no pause and no second ask', async () => {
    const { read } = scripted(ok('rows'))
    const sleep = vi.fn(async () => {})
    const out = await readWithRetry(read, { sleep })
    expect(out).toEqual({ result: ok('rows'), attempts: 1 })
    expect(read).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('a read that fails once is asked again after a 3-second pause, and the second answer is what comes back', async () => {
    const { read } = scripted(fail(), ok('rows'))
    const sleep = vi.fn(async () => {})
    const out = await readWithRetry(read, { sleep })
    expect(out).toEqual({ result: ok('rows'), attempts: 2 })
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(3000)
  })

  it('each attempt BUILDS its own query -- the factory is called again, not the same builder re-awaited', async () => {
    const { read, built } = scripted(fail(), ok('rows'))
    await readWithRetry(read, { sleep: async () => {} })
    expect(built()).toBe(2)
  })

  it('AN OUTAGE IS NOT HIDDEN: a read that fails twice returns the failure, after exactly two asks', async () => {
    const { read } = scripted(fail('first'), fail('second'), ok('never reached'))
    const out = await readWithRetry(read, { sleep: async () => {} })
    expect(out.attempts).toBe(2)
    expect(out.result).toEqual(fail('second'))
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('waits on a real timer by default', async () => {
    vi.useFakeTimers()
    try {
      const { read } = scripted(fail(), ok('rows'))
      let settled = false
      const pending = readWithRetry(read).then((out) => { settled = true; return out })
      await vi.advanceTimersByTimeAsync(2999)
      expect(settled, 'not before three seconds').toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await pending).toEqual({ result: ok('rows'), attempts: 2 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('the defaults are two attempts and a 3-second pause', () => {
    expect(READ_RETRY_ATTEMPTS).toBe(2)
    expect(READ_RETRY_DELAY_MS).toBe(3000)
  })
})
