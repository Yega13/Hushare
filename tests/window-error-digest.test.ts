// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installGlobalErrorReporting } from '@/lib/report-error'

// A BROWSER #419 ROW THAT CAN BE MATCHED TO ITS SERVER ROW.
//
// Three "Minified React error #419" rows arrived with a file, a line and a column -- and nothing that
// said which server failure caused them. React attaches the server's digest to the error; this pins
// that the report carries it. Driven through the real listener with a real ErrorEvent.

let sent: string[] = []
let uninstall: () => void = () => {}

beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(String(init.body))
    return new Response(null, { status: 204 })
  }))
  window.history.replaceState(null, '', '/')
  uninstall = installGlobalErrorReporting()
})
afterEach(() => {
  uninstall()
  vi.unstubAllGlobals()
})

const chunk = () => `${window.location.origin}/_next/static/chunks/0w9xvllif3a-d.js`

describe('a window error from a server render failure', () => {
  it('carries the digest React attached to it', () => {
    const error = Object.assign(new Error('Minified React error #419'), { digest: '2394038921' })
    window.dispatchEvent(new ErrorEvent('error', { message: 'Error: Minified React error #419', filename: chunk(), lineno: 1, colno: 88787, error }))
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]).context).toMatchObject({ digest: '2394038921', line: 1, col: 88787 })
  })

  it('an ordinary error with no digest has no digest field', () => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'TypeError: an ordinary client bug', filename: chunk(), lineno: 1, colno: 5, error: new TypeError('an ordinary client bug') }))
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]).context).not.toHaveProperty('digest')
  })
})
