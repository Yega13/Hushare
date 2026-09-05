import { describe, it, expect, vi, beforeEach } from 'vitest'
// Type-only: erased at compile time, so it does not disturb the vi.mock hoisting below.
import type { Refusal } from '@/lib/server/respond'

// reportServerError creates the service-role admin client on import, so it is mocked here — the
// point of these tests is WHETHER it was called, not what it writes.
const reported: Array<{ source: string; message: string; opts: unknown }> = []
vi.mock('@/lib/report-server-error', () => ({
  reportServerError: (source: string, message: string, opts: unknown) => {
    reported.push({ source, message, opts })
  },
}))

const { ok, refuse, toResponse, refuseRateLimited, refuseAccess, serverError, askCallerToRetry } =
  await import('@/lib/server/respond')

beforeEach(() => { reported.length = 0 })

const ALL_KINDS = [
  { kind: 'bad_request', message: 'no' },
  { kind: 'unauthorized', message: 'no' },
  { kind: 'forbidden', message: 'no' },
  { kind: 'not_found', message: 'no' },
  { kind: 'conflict', message: 'no' },
  { kind: 'rate_limited', message: 'no', retryAfterSeconds: 30 },
  { kind: 'unavailable', message: 'no' },
] as const

describe('no-store is not something a call site can forget', () => {
  it('every refusal kind carries it', () => {
    // 98 hand-written copies of this header existed. They all agreed; the risk was always the
    // ninety-ninth. Asserting EVERY kind means adding a variant without the header fails here.
    for (const r of ALL_KINDS) {
      expect(toResponse(r).headers.get('Cache-Control'), r.kind).toBe('no-store')
    }
  })

  it('so do success and both 5xx builders', () => {
    expect(ok({}).headers.get('Cache-Control')).toBe('no-store')
    expect(serverError('t', 'x').headers.get('Cache-Control')).toBe('no-store')
    expect(askCallerToRetry('t', 'x').headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('a 5xx cannot be produced without reporting it', () => {
  it('serverError reports before it answers', () => {
    // The measurement this exists for: 117 5xx sites in src/app against 36 reportServerError
    // calls, and only 10 of the 64 route files that can 500 called it anywhere at all.
    const res = serverError('upload-presign', new Error('boom'), { albumId: 'a1' })
    expect(res.status).toBe(500)
    expect(reported).toHaveLength(1)
    expect(reported[0].source).toBe('upload-presign')
    expect(reported[0].message).toContain('boom')
  })

  it('askCallerToRetry reports too — those five Polar branches reported nothing', () => {
    askCallerToRetry('polar-webhook', 'apply_failed', { context: { orderId: 'o1' } })
    expect(reported).toHaveLength(1)
    expect(reported[0].message).toContain('apply_failed')
  })

  it('never leaks the internal detail to the caller', async () => {
    const res = serverError('x', new Error('service role key rejected by postgres'))
    expect(await res.json()).toEqual({ error: 'Something went wrong on our side. Please try again.' })
  })
})

describe('the Polar retry contract is preserved exactly', () => {
  it('keeps the machine-readable body the delivery log is read for', async () => {
    // If this ever became a customer sentence, the operator loses the only signal saying WHICH
    // branch fired. That is why askCallerToRetry is its own function and not a flag: the body it
    // returns is byte-identical to what these branches always sent, so Polar's delivery log reads
    // exactly as it did before while the branch now also reaches the admin panel.
    const res = askCallerToRetry('polar-webhook', 'refund_lookup_failed')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'refund_lookup_failed' })
  })
})

describe('Retry-After travels with the decision', () => {
  it('is set from the limiter result, so it cannot be dropped', () => {
    expect(refuseRateLimited({ ok: false, retryAfterSeconds: 30 }).headers.get('Retry-After')).toBe('30')
  })

  it('never rounds down to 0, which means "retry immediately"', () => {
    // A sub-second window floored to 0 turns a rate limit into a retry storm from the room that
    // just triggered it.
    expect(refuseRateLimited({ ok: false, retryAfterSeconds: 0.4 }).headers.get('Retry-After')).toBe('1')
  })

  it('is absent on refusals that are not about waiting', () => {
    expect(refuse({ kind: 'forbidden', message: 'no' }).headers.get('Retry-After')).toBeNull()
  })

  it('CANNOT be omitted when building a rate-limit refusal by hand', () => {
    // A COMPILE-TIME ASSERTION, because the runtime cannot make this one.
    //
    // respond.ts claims that requiring retryAfterSeconds on the type is what stops a ninth route
    // dropping the header. The expectation directive below is what exercises that claim, and it
    // fails the build in BOTH directions: if the field is ever made optional, the directive becomes
    // an unused-directive error and tsc goes red.
    //
    // NOTE FOR WHOEVER EDITS THIS COMMENT: do not begin a line with the directive's name. An
    // earlier version of this block explained the mechanism in prose starting with those exact
    // characters, and TypeScript read the SENTENCE as a directive — silently suppressing the error
    // on the line beneath it, so the real assertion below reported "unused" and the whole guarantee
    // read as broken when it was fine. A comment about a tool is not supposed to be an instruction
    // to it (AGENTS.md rule 24's family: text that means one thing to a reader and another to a
    // parser).
    // @ts-expect-error retryAfterSeconds is required on a rate_limited refusal
    const missing: Refusal = { kind: 'rate_limited', message: 'slow down' }
    expect(missing.kind).toBe('rate_limited')
  })
})

describe('an owner-access failure keeps everything the library decided', () => {
  it('carries Retry-After when the failure was a rate limit', async () => {
    // 31 route files hand-rolled this as `{ error: access.error }` with `access.status`, which
    // dropped both the reason and the wait. /api/checkout/package sent Retry-After on its own
    // limiter's 429 and omitted it on the owner-access 429 two checks later — same endpoint, two
    // 429s, two different shapes.
    const res = refuseAccess({
      status: 429, error: 'Too many requests. Please slow down.',
      reason: 'rate_limited', retryAfterSeconds: 45,
    })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('45')
    expect(await res.json()).toEqual({ error: 'Too many requests. Please slow down.', reason: 'rate_limited' })
  })

  it('does not invent a Retry-After on failures that are not rate limits', () => {
    // A 403 telling someone to retry in N seconds would be a lie — the answer will not change.
    expect(refuseAccess({ status: 403, error: 'Not your album', reason: 'access_denied' })
      .headers.get('Retry-After')).toBeNull()
  })

  it('keeps the reason the library computed, which the hand-rolled version threw away', async () => {
    expect(await refuseAccess({ status: 404, error: 'Album not found', reason: 'not_found' }).json())
      .toEqual({ error: 'Album not found', reason: 'not_found' })
  })

  it('carries no-store like every other answer', () => {
    expect(refuseAccess({ status: 404, error: 'x', reason: 'not_found' })
      .headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('statuses map as claimed', () => {
  it('each kind gets its status', () => {
    const expected: Record<string, number> = {
      bad_request: 400, unauthorized: 401, forbidden: 403, not_found: 404,
      conflict: 409, rate_limited: 429, unavailable: 503,
    }
    for (const r of ALL_KINDS) expect(toResponse(r).status, r.kind).toBe(expected[r.kind])
  })

  it('carries a stable machine token alongside the human message', async () => {
    expect(await refuse({ kind: 'not_found', message: 'Album not found' }).json())
      .toEqual({ error: 'Album not found', reason: 'not_found' })
  })
})
