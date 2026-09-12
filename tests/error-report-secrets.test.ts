// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installGlobalErrorReporting } from '@/lib/report-error'

// THE TWO THINGS A WINDOW ERROR MUST NOT DO: carry an owner's key out of the browser, and file a
// script that is not ours as our error. Both happened on 2026-09-10, from one iPhone running Chrome.
// Driven through the real listener with a real ErrorEvent, and read off the request actually sent.

let sent: string[] = []
let uninstall: () => void = () => {}

beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(String(init.body))
    return new Response(null, { status: 204 })
  }))
  uninstall = installGlobalErrorReporting()
})
afterEach(() => {
  uninstall()
  vi.unstubAllGlobals()
})

const fire = (init: ErrorEventInit) => { window.dispatchEvent(new ErrorEvent('error', init)) }

describe('a window error on an owner link', () => {
  it('is reported with the fragment gone from every field it could ride in', () => {
    window.history.replaceState(null, '', '/jkzvi0aa#owner=FAKE_TOKEN_abc')
    fire({ message: 'TypeError: our own bug, on an owner link', filename: `${window.location.origin}/jkzvi0aa#owner=FAKE_TOKEN_abc`, lineno: 3, colno: 1 })
    expect(sent).toHaveLength(1)
    expect(sent[0]).not.toContain('FAKE_TOKEN')
    expect(sent[0]).not.toContain('owner=')
    expect(JSON.parse(sent[0]).context.file).toBe(`${window.location.origin}/jkzvi0aa`)
  })
})

describe('a script that is not ours', () => {
  it('is not reported: a line the page does not have, or a file with no URL', () => {
    window.history.replaceState(null, '', '/kg3zf2vl')
    fire({ message: 'Error: ta', filename: `${window.location.origin}/kg3zf2vl`, lineno: 425, colno: 18 })
    fire({ message: 'RangeError: Maximum call stack size exceeded.', filename: 'undefined', lineno: 198, colno: 41 })
    expect(sent).toHaveLength(0)
  })
  it('while an error from our own inline script on the same page still is', () => {
    window.history.replaceState(null, '', '/kg3zf2vl')
    fire({ message: 'TypeError: our own bug, inline', filename: `${window.location.origin}/kg3zf2vl`, lineno: 2, colno: 5 })
    expect(sent).toHaveLength(1)
  })
})
