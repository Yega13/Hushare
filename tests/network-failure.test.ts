import { describe, it, expect } from 'vitest'
import { isNetworkFailure } from '../src/lib/network-failure'

// A timed-out fetch is a DOMException that IS an Error, so the old "instanceof Error ? message :
// translated" branch showed the browser's own text. This decides what gets the translated line.

describe('isNetworkFailure', () => {
  it('a fetch that never reached the server (TypeError) is the network', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true)
  })
  it('a fetch the browser gave up on (TimeoutError DOMException) is the network', () => {
    const e = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    expect(e).toBeInstanceOf(Error)          // the reason the old branch missed it
    expect(isNetworkFailure(e)).toBe(true)
  })
  it("a plain Error carrying the server's refusal is NOT the network", () => {
    expect(isNetworkFailure(new Error('Too many requests'))).toBe(false)
  })
  it('an abort that was not a timeout is not called the network either', () => {
    expect(isNetworkFailure(new DOMException('aborted', 'AbortError'))).toBe(false)
  })
  it('not an object at all', () => {
    expect(isNetworkFailure('nope')).toBe(false)
    expect(isNetworkFailure(null)).toBe(false)
    expect(isNetworkFailure(undefined)).toBe(false)
  })
})
