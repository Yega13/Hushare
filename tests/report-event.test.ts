import { describe, it, expect, vi } from 'vitest'
import { reportClientEvent } from '@/lib/upload/report'

// UPLOAD TELEMETRY MUST NEVER BE ABLE TO FAIL AN UPLOAD. That is the whole contract of this module,
// and it is the property a refactor is most likely to break by "cleaning up" a try/catch that looks
// redundant. Every test here either pins the wire shape the server parses, or proves a failure in
// the transport is invisible to the caller.

function capture() {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const transport = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }) })
  return { transport, calls, body: () => JSON.parse(String(calls[0].init.body)) }
}

describe('the wire shape /api/log/client-error parses', () => {
  it('posts JSON to the log route with keepalive, so a closing page still delivers it', () => {
    const c = capture()
    reportClientEvent('warn', 'upload:image-relay', 'switched', 'a1', undefined, c.transport)
    expect(c.calls[0].url).toBe('/api/log/client-error')
    expect(c.calls[0].init.method).toBe('POST')
    expect(c.calls[0].init.keepalive).toBe(true)
    expect((c.calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('carries level, source, message, albumId and the build id inside context', () => {
    const c = capture()
    reportClientEvent('error', 'save', 'Timed out', 'a1', { count: 3 }, c.transport)
    const b = c.body()
    expect(b).toMatchObject({ level: 'error', source: 'save', message: 'Timed out', albumId: 'a1' })
    expect(b.context.count).toBe(3)
    expect(typeof b.context.build).toBe('string')
  })

  it('CLAMPS a runaway message to 500 characters rather than sending it whole', () => {
    // The server groups incidents by exact message. An unbounded message with a per-file detail in
    // it would shatter one outage into a column of one-count chips.
    const c = capture()
    reportClientEvent('warn', 's', 'x'.repeat(2000), 'a1', undefined, c.transport)
    expect(c.body().message).toHaveLength(500)
  })

  it('coerces a non-string message rather than throwing on .slice', () => {
    const c = capture()
    reportClientEvent('warn', 's', 42 as unknown as string, 'a1', undefined, c.transport)
    expect(c.body().message).toBe('42')
  })
})

describe('it can never hurt the caller', () => {
  it('a transport that REJECTS is swallowed', async () => {
    const transport = vi.fn(async () => { throw new Error('offline') })
    expect(() => reportClientEvent('warn', 's', 'm', 'a1', undefined, transport)).not.toThrow()
    await Promise.resolve()   // let the rejection settle; an unhandled one would fail the run
  })

  it('a transport that THROWS synchronously is swallowed', () => {
    const transport = (() => { throw new Error('no fetch here') }) as never
    expect(() => reportClientEvent('warn', 's', 'm', 'a1', undefined, transport)).not.toThrow()
  })

  it('returns void -- nothing for a caller to await, so nothing for a caller to block on', () => {
    const c = capture()
    expect(reportClientEvent('warn', 's', 'm', 'a1', undefined, c.transport)).toBeUndefined()
  })
})
