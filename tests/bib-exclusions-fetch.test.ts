// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchBibExclusions } from '@/components/owner-toolbar/api'

// A 200 IS NOT A SHAPE.
//
// The panel reads rows.length during render. Nothing in this app mounts ErrorBoundary, so a throw
// inside that render reaches app/error.tsx and replaces the owner's ENTIRE ALBUM PAGE with an error
// screen -- over a dropdown in Settings they may not have opened deliberately.
//
// The ways a 200 arrives without the expected body are all real: a captive portal or corporate
// proxy answering with its own HTML, a response truncated mid-flight, and -- for exactly one deploy
// cycle -- a browser still holding the bundle from before this response renamed `candidates` to
// `rows`. Two albums have bib search switched on, so that last one is small; the first two are not
// bounded by anything.
//
// Every unusable body is "could not ask", which is what null means here. It is never "this album
// has no signage", because that is a claim about the album (rule 20).

function respond(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('fetchBibExclusions — an unusable answer is not an answer', () => {
  it('reads a well-formed body', async () => {
    respond({ rows: [{ number: '2026', photos: 1145 }], excluded: ['2026'] })
    const v = await fetchBibExclusions('race')
    expect(v?.rows).toHaveLength(1)
    expect(v?.excluded).toEqual(['2026'])
  })

  it('refuses a body with no rows, rather than crashing the album page during render', async () => {
    // The exact shape a browser holding the previous bundle receives: the field it reads is gone.
    respond({ candidates: [{ number: '2026', photos: 1145 }], excluded: [] })
    expect(await fetchBibExclusions('race')).toBeNull()
  })

  it('refuses a body with no excluded list', async () => {
    respond({ rows: [] })
    expect(await fetchBibExclusions('race')).toBeNull()
  })

  it('refuses a body that is not an object at all', async () => {
    respond(null)
    expect(await fetchBibExclusions('race')).toBeNull()
    respond('<html>blocked by proxy</html>')
    expect(await fetchBibExclusions('race')).toBeNull()
  })

  it('refuses rows that are not an array, however friendly the value looks', async () => {
    respond({ rows: { 0: { number: '2026', photos: 3 } }, excluded: [] })
    expect(await fetchBibExclusions('race')).toBeNull()
  })

  it('accepts an empty album: no numbers, nothing excluded', async () => {
    // This one must NOT be null. Empty is a real answer, and the panel hides itself on it -- if it
    // were treated as a failure the distinction between the two would stop existing.
    respond({ rows: [], excluded: [] })
    expect(await fetchBibExclusions('race')).toEqual({ rows: [], excluded: [] })
  })

  it('returns null on a non-200', async () => {
    respond({ rows: [], excluded: [] }, false)
    expect(await fetchBibExclusions('race')).toBeNull()
  })

  it('returns null when the body is not JSON at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => { throw new SyntaxError('Unexpected token <') },
    })))
    expect(await fetchBibExclusions('race')).toBeNull()
  })
})
