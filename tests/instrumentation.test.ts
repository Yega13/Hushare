import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Next calls src/instrumentation.ts's onRequestError for every server error. If the export is renamed,
// or stops forwarding, every server render error goes back to being invisible -- and nothing fails.

const calls: unknown[][] = []
vi.mock('@/lib/server/request-error', () => ({ reportRequestError: (...a: unknown[]) => { calls.push(a) } }))

const { onRequestError } = await import('@/instrumentation')

const savedRuntime = process.env.NEXT_RUNTIME
beforeEach(() => { calls.length = 0 })
afterEach(() => {
  if (savedRuntime === undefined) delete process.env.NEXT_RUNTIME
  else process.env.NEXT_RUNTIME = savedRuntime
})

describe('src/instrumentation.ts', () => {
  it('hands every server error, its request and its context to the reporter on Node.js', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    const err = new Error('render failed')
    const request = { path: '/', method: 'GET', headers: {} }
    const context = { routerKind: 'App Router', routePath: '/page', routeType: 'render', renderSource: 'server-rendering' }
    await onRequestError(err, request, context)
    expect(calls).toEqual([[err, request, context]])
  })

  it('does nothing on the edge runtime, where the reporter cannot run', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    await onRequestError(new Error('x'), { path: '/', method: 'GET' }, {})
    expect(calls).toEqual([])
  })
})
