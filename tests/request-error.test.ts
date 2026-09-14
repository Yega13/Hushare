import { describe, it, expect, vi } from 'vitest'

// THE SERVER ERRORS THAT NEVER REACHED THE PANEL.
//
// Three "React error #419" rows on the home page were the only trace of a server render failure: the
// real error went to console.error, which nobody reads on this deployment. These pin what a server
// error row carries -- and what it must never carry, or be.

vi.mock('@/lib/report-server-error', () => ({ reportServerError: () => {} }))

const { describeRequestError, reportRequestError, CONTROL_FLOW_DIGESTS } = await import('@/lib/server/request-error')

const render = { routerKind: 'App Router', routePath: '/page', routeType: 'render', renderSource: 'server-rendering' }

describe('describeRequestError', () => {
  it('names the route and the error, and carries the digest the browser also received', () => {
    const err = Object.assign(new TypeError('cannot read properties of undefined'), { digest: '2394038921' })
    const d = describeRequestError(err, { path: '/', method: 'GET' }, render)
    expect(d?.source).toBe('render:/page')
    expect(d?.message).toBe('TypeError: cannot read properties of undefined')
    expect(d?.context).toMatchObject({ path: '/', method: 'GET', digest: '2394038921', renderSource: 'server-rendering' })
  })

  it('A QUERY OR FRAGMENT NEVER REACHES THE ERROR TABLE', () => {
    const d = describeRequestError(new Error('boom'), { path: '/api/download/photo?id=abc&token=SECRET#owner=KEY', method: 'GET' }, { routePath: '/api/download/photo/route', routeType: 'route' })
    expect(d?.context.path).toBe('/api/download/photo')
    expect(JSON.stringify(d)).not.toContain('SECRET')
    expect(JSON.stringify(d)).not.toContain('KEY')
  })

  it('keeps the first five stack frames, and no more', () => {
    const err = new Error('boom')
    err.stack = ['Error: boom', 'at a (a.js:1)', 'at b (b.js:2)', 'at c (c.js:3)', 'at d (d.js:4)', 'at e (e.js:5)', 'at f (f.js:6)'].join(String.fromCharCode(10))
    const d = describeRequestError(err, { path: '/', method: 'GET' }, render)
    expect(d?.context.stack).toBe('at a (a.js:1) | at b (b.js:2) | at c (c.js:3) | at d (d.js:4) | at e (e.js:5)')
  })

  it('NEXT\'S OWN CONTROL FLOW IS NOT AN ERROR: redirect, notFound, a client-rendering bailout, dynamic usage', () => {
    expect(CONTROL_FLOW_DIGESTS).toEqual([
      'NEXT_REDIRECT', 'NEXT_HTTP_ERROR_FALLBACK', 'BAILOUT_TO_CLIENT_SIDE_RENDERING',
      'DYNAMIC_SERVER_USAGE', 'NEXT_PRERENDER_INTERRUPTED', 'HANGING_PROMISE_REJECTION',
    ])
    for (const digest of ['NEXT_REDIRECT;replace;/abc;307;', 'NEXT_HTTP_ERROR_FALLBACK;404', 'BAILOUT_TO_CLIENT_SIDE_RENDERING', 'DYNAMIC_SERVER_USAGE']) {
      expect(describeRequestError(Object.assign(new Error('x'), { digest }), { path: '/', method: 'GET' }, { routeType: 'route', routePath: '/r' }), digest).toBeNull()
    }
  })

  it('a thrown value that is not an Error is still filed, with the route path standing in when Next gives none', () => {
    const d = describeRequestError('plain string', { path: '/x?y=1', method: '' }, {})
    expect(d).toEqual({ source: 'request:/x', message: 'plain string', context: { path: '/x', method: 'GET' } })
  })

  it('an empty digest is no digest', () => {
    const d = describeRequestError(Object.assign(new Error('x'), { digest: '' }), { path: '/', method: 'GET' }, render)
    expect(d?.context).not.toHaveProperty('digest')
  })
})

describe('reportRequestError', () => {
  it('files a real failure through the server reporter', () => {
    const calls: unknown[][] = []
    reportRequestError(Object.assign(new Error('boom'), { digest: '77' }), { path: '/', method: 'GET' }, render, (...a) => { calls.push(a) })
    expect(calls).toEqual([['render:/page', 'Error: boom', { context: expect.objectContaining({ digest: '77', path: '/' }) }]])
  })

  it('files nothing for a redirect', () => {
    const calls: unknown[][] = []
    reportRequestError(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;push;/x;307;' }), { path: '/', method: 'GET' }, render, (...a) => { calls.push(a) })
    expect(calls).toEqual([])
  })

  it('never throws, even when the reporter does', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => reportRequestError(new Error('x'), { path: '/', method: 'GET' }, render, () => { throw new Error('reporter down') })).not.toThrow()
  })
})
