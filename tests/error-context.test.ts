import { describe, it, expect } from 'vitest'
import { boundedContext, MAX_VALUE_CHARS, MAX_CONTEXT_CHARS } from '@/lib/error-context'
import { stackFrames, STACK_CHARS } from '@/lib/report-error'

// WHAT A CRASH REPORT IS ALLOWED TO CARRY — and why it stopped carrying the useful part.
//
// A real customer hit React error #310 on an album page on 2026-09-02. Two things conspired so that
// the report could not identify what threw:
//
//   1. the boundary stored `error.stack.slice(0, 400)`, and `error.stack` STARTS with the message —
//      React's minified error text is ~180 characters on its own, and each production frame is a
//      long hashed chunk URL, so what survived was three frames of React internals. The capture
//      stopped at `at r.useMemo (https://hushare.space/_ne`, one character short of anything nameable;
//   2. the server dropped the WHOLE context object when its JSON passed 800 characters, so a deeper
//      crash — the kind with a big stack — also lost its digest, its build id and its path.
//
// Between them, the more serious the crash, the less was recorded about it.

describe('a stored stack is frames, not the message again', () => {
  const v8 = [
    'Error: Minified React error #310; visit https://react.dev/errors/310 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.',
    '    at aP (https://hushare.space/_next/static/chunks/0w9xvllif3a-d.js:1:64172)',
    '    at Object.ol [as useMemo] (https://hushare.space/_next/static/chunks/0w9xvllif3a-d.js:1:71639)',
    '    at AlbumPageClient (https://hushare.space/_next/static/chunks/page-abc.js:1:2200)',
  ].join('\n')

  it('drops the message line, so the frames get the room', () => {
    const out = stackFrames(v8) as string
    expect(out.startsWith('    at aP')).toBe(true)
    expect(out, 'the message is already stored in its own column').not.toContain('Minified React error')
  })

  it('keeps enough frames to reach OUR code past the framework', () => {
    // The whole point. Under the old 400-char slice this frame was never captured, which is why the
    // first #310 could not be diagnosed at all.
    expect(stackFrames(v8)).toContain('AlbumPageClient')
  })

  it('keeps a Firefox/Safari stack whole rather than emptying it', () => {
    // Those engines have no message line and no "at " prefix. Returning nothing for them would be
    // the silent failure this function exists to remove (rule 19).
    const gecko = 'aP@https://hushare.space/x.js:1:64172\nol@https://hushare.space/x.js:1:71639'
    expect(stackFrames(gecko)).toContain('aP@')
  })

  it('is bounded, and answers undefined for nothing', () => {
    const huge = 'x'.repeat(50_000)
    expect((stackFrames(`Error: y\n    at ${huge}`) as string).length).toBeLessThanOrEqual(STACK_CHARS)
    expect(stackFrames(undefined)).toBeUndefined()
    expect(stackFrames('')).toBeUndefined()
  })

  it('fits inside the server clamp, so it is not trimmed twice', () => {
    // If STACK_CHARS ever exceeds MAX_VALUE_CHARS the cut silently moves to the server and the
    // client's sizing becomes decoration.
    expect(STACK_CHARS).toBeLessThanOrEqual(MAX_VALUE_CHARS)
  })
})

describe('an oversized context is trimmed, never thrown away whole', () => {
  it('keeps every key and shortens only what is too long', () => {
    // THE DEFECT. The old rule was all-or-nothing, so one long stack cost the digest, the build id
    // and the path as well — on precisely the crashes worth reading.
    const ctx = boundedContext({
      digest: 'abc123',
      build: '9e87e95-mtkdhz5q',
      path: '/party',
      stack: 'z'.repeat(5_000),
    })
    expect(ctx).not.toBeNull()
    expect(ctx!.digest, 'the digest ties this to the server log line').toBe('abc123')
    expect(ctx!.build).toBe('9e87e95-mtkdhz5q')
    expect(ctx!.path).toBe('/party')
    expect((ctx!.stack as string).length).toBe(MAX_VALUE_CHARS)
  })

  it('leaves a normal context exactly as it was', () => {
    const ctx = { digest: 'd', repeats: 2, fatal: true, path: '/x' }
    expect(boundedContext(ctx)).toEqual(ctx)
  })

  it('still bounds the row against a hostile client', () => {
    // The cap is why this exists at all: anyone can POST to that endpoint.
    const many: Record<string, string> = {}
    for (let i = 0; i < 100; i++) many[`k${i}`] = 'y'.repeat(MAX_VALUE_CHARS)
    const ctx = boundedContext(many)
    if (ctx !== null) expect(JSON.stringify(ctx).length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS)
  })

  it('refuses things that are not a plain object', () => {
    expect(boundedContext(null)).toBeNull()
    expect(boundedContext('a string')).toBeNull()
    expect(boundedContext(['an', 'array'])).toBeNull()
    expect(boundedContext({})).toBeNull()
  })

  it('does not store a number JSON cannot represent', () => {
    // JSON.stringify turns Infinity and NaN into null, so the key would survive carrying a value
    // that means nothing. Dropping it is better than recording a lie (rule 20).
    const ctx = boundedContext({ ok: 1, bad: Number.POSITIVE_INFINITY, alsoBad: Number.NaN })
    expect(ctx).toEqual({ ok: 1 })
  })

  it('survives a circular object instead of throwing on a logging endpoint', () => {
    const circular: Record<string, unknown> = { digest: 'd' }
    circular.self = circular
    const ctx = boundedContext(circular)
    expect(ctx).toEqual({ digest: 'd' })
  })

  it('flattens a nested blob rather than letting it cost more than a string', () => {
    const ctx = boundedContext({ digest: 'd', nested: { a: 'x'.repeat(5_000) } })
    expect(typeof ctx!.nested).toBe('string')
    expect((ctx!.nested as string).length).toBeLessThanOrEqual(MAX_VALUE_CHARS)
  })
})
