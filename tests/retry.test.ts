import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createUploadTransport, withTimeoutSignal,
  FETCH_DEADLINE_DEFAULT_MS, FETCH_ATTEMPT_TIMEOUT_MS, MAX_SERVER_ERROR_ATTEMPTS, MAX_RECOVERY_GRACES, PUT_DEADLINE_MS,
  type TransportDeps, type Stored,
} from '@/lib/upload/retry'
import { HttpError } from '@/lib/upload/http'
import { createReachability } from '@/lib/upload/reachability'
import { createRelayPolicy, backoffDelay } from '@/lib/upload-policy'

// THE RETRY LOOPS, TESTED FOR THE FIRST TIME. Every comment in lib/upload/retry.ts names an incident
// -- 25 photos lost in 61 seconds, 8 files dead with no bytes moved, 328 Worker kills -- and until
// now nothing but a re-read of the code stood between those and happening again.
//
// TIME: fake timers drive the sleeps; performance.now is pinned to the fake Date plus an offset a
// fake can bump, so "the probe took 28 seconds" is one assignment rather than a wait.

let offset = 0
const bump = (ms: number) => { offset += ms }

beforeEach(() => {
  vi.useFakeTimers()
  offset = 0
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now() + offset)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

/** Let the loop run: advance fake time far past any budget, then read the outcome. A loop that never ends fails on the test timeout. */
async function outcome<T>(p: Promise<T>): Promise<{ ok: T } | { err: unknown }> {
  const r = p.then((ok) => ({ ok }), (err) => ({ err }))
  await vi.advanceTimersByTimeAsync(500_000)
  return r
}

type FetchStep = number | 'down' | 'hang' | 'boom'
/** Scripted fetch: a status -> Response with that status; 'down' -> TypeError; 'hang' -> waits for the signal; 'boom' -> a non-network Error. Repeats its last step. */
function scriptedFetch(script: FetchStep[]) {
  let i = 0
  const calls: RequestInit[] = []
  const responses: Response[] = []
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(init)
    const step = script[Math.min(i++, script.length - 1)]
    if (step === 'down') throw new TypeError('Failed to fetch')
    if (step === 'boom') throw new Error('something unrelated')
    if (step === 'hang') {
      const signal = init.signal as AbortSignal
      return new Promise<Response>((_, reject) => {
        if (signal.aborted) { reject(signal.reason); return }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    const res = new Response(`body-${i}`, { status: step })
    responses.push(res)
    return res
  })
  return { fetch, calls, responses }
}

type PutStep = { ok: string } | { http: number } | 'down' | 'abort'
/** Scripted xhrPut. Optional `advance` bumps the monotonic clock per attempt, so a deadline can be spent without sleeping. */
function scriptedPut(script: PutStep[], advance = 0) {
  let i = 0
  const calls: Array<{ method: string; url: string; contentType: string; signal?: AbortSignal }> = []
  const xhrPut = vi.fn(async (method: 'PUT' | 'POST', url: string, _body: Blob, contentType: string, _onProgress: (pct: number) => void, signal?: AbortSignal) => {
    calls.push({ method, url, contentType, signal })
    bump(advance)
    const step = script[Math.min(i++, script.length - 1)]
    if (step === 'down') throw new Error('Network error during upload')
    if (step === 'abort') throw new DOMException('Upload aborted', 'AbortError')
    if ('http' in step) throw new HttpError(step.http, `status ${step.http}`)
    return step.ok
  })
  return { xhrPut, calls }
}

/** A reachability whose answer is scripted, and which can spend clock time "probing". */
function scriptedReach(answer: boolean | boolean[], spends = 0) {
  let i = 0
  const answers = Array.isArray(answer) ? answer : [answer]
  const calledAt: number[] = []
  const awaitRecovery = vi.fn<(opts: { remainingMs: number; signal?: AbortSignal }) => Promise<boolean>>(async () => {
    calledAt.push(Date.now())
    bump(spends)
    return answers[Math.min(i++, answers.length - 1)]
  })
  return { awaitRecovery, calledAt }
}

function transport(over: Partial<TransportDeps>) {
  const deps: TransportDeps = {
    fetch: scriptedFetch([200]).fetch,
    xhrPut: scriptedPut([{ ok: '' }]).xhrPut,
    reachability: scriptedReach(true),
    relayPolicy: createRelayPolicy(() => performance.now()),
    report: vi.fn(),
    random: () => 0.5,
    ...over,
  }
  return { t: createUploadTransport(deps), deps }
}

const body = new Blob(['bytes'])
const noProgress = () => {}
const ORIGINAL: Stored = { key: 'k-orig', publicUrl: 'https://cdn/k-orig' }
const RELAY = { albumId: 'alb 1', fileName: 'IMG 001.jpg', contentType: 'image/jpeg', isThumb: false }

// ─── fetchWithRetry ─────────────────────────────────────────────────────────────────────────────

describe('fetchWithRetry -- the control plane', () => {
  it('returns a 2xx at once, passes init through with its own per-attempt signal, and leaves no timer behind', async () => {
    const f = scriptedFetch([200])
    const { t, deps } = transport({ fetch: f.fetch })
    // Awaited directly, with no fake time advanced: an orphaned per-attempt timer must still be
    // there to be counted, not quietly fired and forgotten.
    const res = await t.fetchWithRetry('/api/upload/presign', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }).then((ok) => ({ ok }))
    expect(res.ok.status).toBe(200)
    expect(f.calls[0]).toMatchObject({ method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })
    expect(f.calls[0].signal).toBeInstanceOf(AbortSignal)
    expect(deps.reachability.awaitRecovery).not.toHaveBeenCalled()
    expect(vi.getTimerCount(), 'the per-attempt timeout was not cleaned up').toBe(0)
  })

  it('a 4xx is a verdict, not a failure: returned on the first try, never retried', async () => {
    const f = scriptedFetch([413])
    const { t } = transport({ fetch: f.fetch })
    const res = await outcome(t.fetchWithRetry('/x', {}))
    expect('ok' in res && res.ok.status).toBe(413)
    expect(f.fetch).toHaveBeenCalledTimes(1)
  })

  it('a 5xx is retried after a jittered backoff, and the replaced 5xx body is drained', async () => {
    const f = scriptedFetch([503, 200])
    const { t, deps } = transport({ fetch: f.fetch })
    const res = await outcome(t.fetchWithRetry('/x', {}))
    expect('ok' in res && res.ok.status).toBe(200)
    expect(f.fetch).toHaveBeenCalledTimes(2)
    expect(f.responses[0].bodyUsed, 'the superseded 5xx kept its connection pinned').toBe(true)
    expect(deps.reachability.awaitRecovery, 'a server that ANSWERED must not trigger the outage probe').not.toHaveBeenCalled()
  })

  it('a 429 is retried like a 5xx', async () => {
    const f = scriptedFetch([429, 200])
    const { t } = transport({ fetch: f.fetch })
    const res = await outcome(t.fetchWithRetry('/x', {}))
    expect('ok' in res && res.ok.status).toBe(200)
  })

  it(`stops after ${MAX_SERVER_ERROR_ATTEMPTS} server errors and returns the LAST one, body intact -- not a generic throw`, async () => {
    // A venue behind one NAT hammering a struggling origin is how a slow database becomes a tripped
    // rate limit. And the caller reads the server's own message out of the body it gets back.
    const f = scriptedFetch([500, 502, 503, 500, 200])
    const { t } = transport({ fetch: f.fetch })
    const res = await outcome(t.fetchWithRetry('/x', {}))
    expect(f.fetch).toHaveBeenCalledTimes(MAX_SERVER_ERROR_ATTEMPTS)
    if (!('ok' in res)) throw res.err
    expect(res.ok.status).toBe(500)
    expect(res.ok).toBe(f.responses[MAX_SERVER_ERROR_ATTEMPTS - 1])
    // Every superseded 5xx was drained as it was replaced; the returned one was not touched.
    expect(f.responses.slice(0, MAX_SERVER_ERROR_ATTEMPTS - 1).map((r) => r.bodyUsed)).toEqual([true, true, true])
    expect(res.ok.bodyUsed).toBe(false)
    expect(await res.ok.text(), 'the returned response must still be readable').toBe(`body-${MAX_SERVER_ERROR_ATTEMPTS}`)
  })

  it('a dead connection asks the page-wide probe, with THIS call’s remaining budget and its signal', async () => {
    const f = scriptedFetch(['down', 200])
    const reach = scriptedReach(true, 1000)
    const ctrl = new AbortController()
    const { t } = transport({ fetch: f.fetch, reachability: reach })
    bump(5000)   // five seconds already spent before the attempt failed
    const res = await outcome(t.fetchWithRetry('/x', {}, { signal: ctrl.signal }))
    expect('ok' in res && res.ok.status).toBe(200)
    expect(reach.awaitRecovery).toHaveBeenCalledTimes(1)
    const arg = reach.awaitRecovery.mock.calls[0][0]
    expect(arg.remainingMs).toBe(FETCH_DEADLINE_DEFAULT_MS)   // the deadline started AFTER the bump
    expect(arg.signal).toBe(ctrl.signal)
  })

  it('a confirmed recovery re-issues the request IMMEDIATELY -- no backoff after a wait already served', async () => {
    const f = scriptedFetch(['down', 200])
    const reach = scriptedReach(true, 2000)
    const { t } = transport({ fetch: f.fetch, reachability: reach })
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    await outcome(t.fetchWithRetry('/x', {}))
    // Only the two 20s per-attempt timers may have been scheduled; no backoff sleep between them.
    const sleeps = setTimeoutSpy.mock.calls.map((c) => c[1] as number).filter((ms) => ms !== FETCH_ATTEMPT_TIMEOUT_MS)
    expect(sleeps, 'a backoff sleep was taken after the probe had already confirmed the origin').toEqual([])
    expect(f.fetch).toHaveBeenCalledTimes(2)
  })

  it('a recovery on the doorstep of the deadline is granted grace, so the one attempt saved up for is actually made', async () => {
    // 2026-08-18 19:47: the probe returned true with no time left, the loop fell into the backoff,
    // found the deadline passed, and threw "Failed to fetch" having just proved the server was up.
    // The re-issued request meets a 503 on an origin still warming up. Inside the grace that is a
    // retry; without it the deadline has passed and the 503 is handed back as the final answer.
    const f = scriptedFetch(['down', 503, 200])
    const reach = scriptedReach(true, FETCH_DEADLINE_DEFAULT_MS - 200)   // recovered with 200ms left
    const { t } = transport({ fetch: f.fetch, reachability: reach })
    const res = await outcome(t.fetchWithRetry('/x', {}))
    expect('ok' in res && res.ok.status, 'gave up after the origin had confirmed it was back').toBe(200)
    expect(f.fetch).toHaveBeenCalledTimes(3)
  })

  it(`a flapping network extends the deadline at most ${MAX_RECOVERY_GRACES} times, then the loop ends`, async () => {
    // An origin that answers HEAD while this particular request keeps failing would otherwise spin
    // probe->retry->probe forever with no backoff, against our own health endpoint.
    // Thirty dead attempts then a 200: a loop that keeps granting grace reaches the 200 and "succeeds".
    const f = scriptedFetch([...Array<FetchStep>(30).fill('down'), 200])
    const reach = scriptedReach(true, 6000)   // each probe "succeeds" after 6s -- less than the 8s grace
    const { t } = transport({ fetch: f.fetch, reachability: reach })
    const res = await outcome(t.fetchWithRetry('/x', {}))
    expect('err' in res, 'the loop kept extending itself until the network came back').toBe(true)
    expect(f.fetch.mock.calls.length).toBeLessThan(12)
  })

  it('the post-recovery skip is ONE attempt, not a mode: once the graces are spent, backoff resumes', async () => {
    // `skipBackoff = false` after the backoff block is what limits the skip to the next attempt.
    // Without it, two confirmed recoveries switch the backoff off for the rest of the call: an
    // origin that answers HEAD but not this request is then hit as fast as the probe returns.
    // Unlike the flapping test above, the probe answers at once, so the only thing that can
    // bound the attempt count is the backoff itself.
    const f = scriptedFetch(['down'])
    const reach = scriptedReach(true, 100)   // "up" every time, 100ms of clock per probe
    const { t } = transport({ fetch: f.fetch, reachability: reach })
    const res = await outcome(t.fetchWithRetry('/x', {}))
    expect('err' in res).toBe(true)
    expect(f.fetch.mock.calls.length).toBeGreaterThan(MAX_RECOVERY_GRACES + 1)
    expect(f.fetch.mock.calls.length, 'no backoff between attempts after the graces were spent').toBeLessThan(12)
  })

  it('never sleeps past the deadline just to fail on the far side: less time left than one backoff means stop now', async () => {
    const f = scriptedFetch(['down'])
    const reach = scriptedReach(false, FETCH_DEADLINE_DEFAULT_MS - 200)   // the probe gave up with 200ms left
    const { t } = transport({ fetch: f.fetch, reachability: reach })
    const res = await outcome(t.fetchWithRetry('/x', {}))
    if (!('err' in res)) throw new Error('resolved')
    expect(f.fetch, 'an attempt was issued after a sleep that overran the budget').toHaveBeenCalledTimes(1)
    expect((res.err as { waitedMs: number }).waitedMs).toBeLessThan(FETCH_DEADLINE_DEFAULT_MS)
  })

  it('out of time with a retained 5xx returns THAT response rather than throwing -- the caller reads the server’s reason from it', async () => {
    const f = scriptedFetch([503, 'down'])
    const reach = scriptedReach(false, 40_000)
    const { t } = transport({ fetch: f.fetch, reachability: reach })
    const res = await outcome(t.fetchWithRetry('/x', {}))
    if (!('ok' in res)) throw res.err
    expect(res.ok.status).toBe(503)
    expect(await res.ok.text()).toBe('body-1')
  })

  it('out of time with nothing but network errors: names the endpoint, keeps the original text first, carries waitedMs as data', async () => {
    const f = scriptedFetch(['down'])
    const reach = scriptedReach(false, 40_000)   // one probe that gives up after the budget
    const { t } = transport({ fetch: f.fetch, reachability: reach })
    const res = await outcome(t.fetchWithRetry('https://hushare.space/api/upload/presign?x=1', {}))
    if (!('err' in res)) throw new Error('resolved')
    const err = res.err as Error & { waitedMs: number }
    expect(err.message).toBe('Failed to fetch (/api/upload/presign)')
    expect(err.waitedMs).toBeGreaterThanOrEqual(FETCH_DEADLINE_DEFAULT_MS)
    expect(err.message, 'the wait must not be in the message -- /admin groups by exact string').not.toMatch(/\d{4,}/)
  })

  it('a non-network throw backs off and retries WITHOUT consulting the probe', async () => {
    const f = scriptedFetch(['boom', 200])
    const reach = scriptedReach(true)
    const { t } = transport({ fetch: f.fetch, reachability: reach })
    const res = await outcome(t.fetchWithRetry('/x', {}))
    expect('ok' in res && res.ok.status).toBe(200)
    expect(reach.awaitRecovery).not.toHaveBeenCalled()
  })

  it(`a request that hangs is cut off after ${FETCH_ATTEMPT_TIMEOUT_MS / 1000}s and treated as a dead connection`, async () => {
    const f = scriptedFetch(['hang', 200])
    const reach = scriptedReach(true)
    const { t } = transport({ fetch: f.fetch, reachability: reach })
    const startedAt = Date.now()
    const res = await outcome(t.fetchWithRetry('/x', {}))
    expect('ok' in res && res.ok.status).toBe(200)
    expect(reach.awaitRecovery, 'a timeout must wait for the origin, not burn attempts').toHaveBeenCalledTimes(1)
    expect(reach.calledAt[0] - startedAt, 'the hung attempt was not cut off on time').toBe(FETCH_ATTEMPT_TIMEOUT_MS)
  })

  it('the caller’s cancel is final: AbortError, no further attempt, retained 5xx drained', async () => {
    const f = scriptedFetch([503, 'hang'])
    const { t } = transport({ fetch: f.fetch })
    const ctrl = new AbortController()
    const p = t.fetchWithRetry('/x', {}, { signal: ctrl.signal })
    let settledAt = -1
    const r = p.then(() => 'resolved', (e: DOMException) => { settledAt = Date.now(); return e.name })
    await vi.advanceTimersByTimeAsync(2000)   // past the first backoff, into the hanging second attempt
    const abortedAt = Date.now()
    ctrl.abort()
    await vi.advanceTimersByTimeAsync(100_000)
    expect(await r).toBe('AbortError')
    expect(settledAt - abortedAt, 'the cancel waited for the attempt timeout instead of cutting the request').toBe(0)
    expect(f.fetch).toHaveBeenCalledTimes(2)
    expect(f.responses[0].bodyUsed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a cancel DURING the outage wait ends the call promptly, not when the window runs out', async () => {
    // fetchWithRetry used to race the probe against its deadline with no way out on cancel: a guest
    // tapping Cancel in a 30-second outage waited the full 30 seconds. With the real reachability.
    const health = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const reach = createReachability({ fetch: health, random: () => 0.5 })
    const f = scriptedFetch(['down'])
    const { t } = transport({ fetch: f.fetch, reachability: reach })
    const ctrl = new AbortController()
    const p = t.fetchWithRetry('/x', {}, { signal: ctrl.signal })
    let settledAt = -1
    const r = p.then(() => 'resolved', (e: DOMException) => { settledAt = Date.now(); return e.name })
    await vi.advanceTimersByTimeAsync(3000)
    const abortedAt = Date.now()
    ctrl.abort()
    await vi.advanceTimersByTimeAsync(100_000)
    expect(await r).toBe('AbortError')
    expect(f.fetch.mock.calls.length).toBeLessThanOrEqual(2)
    // The abort was honoured within one backoff step (under a second here), not at the deadline.
    expect(settledAt - abortedAt).toBeLessThan(2000)
  })

  it('honours a caller’s longer deadline (the save waits six times as long)', async () => {
    const f = scriptedFetch(['down'])
    const reach = scriptedReach(false, 100_000)
    const { t } = transport({ fetch: f.fetch, reachability: reach })
    const res = await outcome(t.fetchWithRetry('/api/album/photos/create', {}, { deadlineMs: 180_000 }))
    if (!('err' in res)) throw new Error('resolved')
    expect((res.err as { waitedMs: number }).waitedMs).toBeGreaterThanOrEqual(180_000)
    expect(reach.awaitRecovery.mock.calls[0][0].remainingMs).toBe(180_000)
  })
})

// ─── putWithRetry ───────────────────────────────────────────────────────────────────────────────

describe('putWithRetry -- the bytes, direct to R2', () => {
  it('a clean PUT resolves after one attempt with the exact arguments', async () => {
    const put = scriptedPut([{ ok: '' }])
    const { t } = transport({ xhrPut: put.xhrPut })
    const ctrl = new AbortController()
    const res = await outcome(t.putWithRetry('https://r2/signed', body, 'image/jpeg', noProgress, ctrl.signal))
    expect('ok' in res).toBe(true)
    expect(put.calls).toEqual([{ method: 'PUT', url: 'https://r2/signed', contentType: 'image/jpeg', signal: ctrl.signal }])
  })

  it('R2 refusing with a 4xx is final -- thrown as-is, one attempt, no probe', async () => {
    const put = scriptedPut([{ http: 403 }])
    const reach = scriptedReach(true)
    const { t } = transport({ xhrPut: put.xhrPut, reachability: reach })
    const res = await outcome(t.putWithRetry('u', body, 'image/jpeg', noProgress))
    expect('err' in res && res.err).toBeInstanceOf(HttpError)
    expect('err' in res && (res.err as HttpError).status).toBe(403)
    expect(put.xhrPut).toHaveBeenCalledTimes(1)
    expect(reach.awaitRecovery).not.toHaveBeenCalled()
  })

  it('an R2 5xx is retried after a backoff -- and does NOT consult the probe, because R2 answered', async () => {
    const put = scriptedPut([{ http: 503 }, { ok: '' }])
    const reach = scriptedReach(true)
    const { t } = transport({ xhrPut: put.xhrPut, reachability: reach })
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const res = await outcome(t.putWithRetry('u', body, 'image/jpeg', noProgress))
    expect('ok' in res).toBe(true)
    expect(put.xhrPut).toHaveBeenCalledTimes(2)
    expect(reach.awaitRecovery).not.toHaveBeenCalled()
    // The retry WAITED. xhrPut is a fake here, so the only timer this loop can schedule is the
    // backoff sleep -- and the imported curve, not a number re-derived here, says how long (rule 17).
    const sleeps = setTimeoutSpy.mock.calls.map((c) => c[1] as number)
    expect(sleeps, 'the first retry fired with no backoff').toEqual([backoffDelay(1, () => 0.5)])
  })

  it('no answer at all waits for the origin (page-wide probe, this call’s budget and signal) before the next attempt', async () => {
    const put = scriptedPut(['down', { ok: '' }], 1000)
    const reach = scriptedReach(true)
    const ctrl = new AbortController()
    const { t } = transport({ xhrPut: put.xhrPut, reachability: reach })
    const res = await outcome(t.putWithRetry('u', body, 'image/jpeg', noProgress, ctrl.signal))
    expect('ok' in res).toBe(true)
    expect(reach.awaitRecovery).toHaveBeenCalledTimes(1)
    expect(reach.awaitRecovery.mock.calls[0][0]).toEqual({ remainingMs: PUT_DEADLINE_MS - 1000, signal: ctrl.signal })
  })

  it(`keeps trying for the full ${PUT_DEADLINE_MS / 1000}s budget, then throws the LAST error`, async () => {
    // 2026-08-17: a fixed 5 attempts gave ~7.5s of tolerance; a 61-second drop killed 25 photos.
    const put = scriptedPut(['down'], 10_000)   // each attempt "takes" 10s of clock
    const reach = scriptedReach(false)
    const { t } = transport({ xhrPut: put.xhrPut, reachability: reach })
    const startedAt = performance.now()
    const res = await outcome(t.putWithRetry('u', body, 'image/jpeg', noProgress))
    if (!('err' in res)) throw new Error('resolved')
    expect((res.err as Error).message).toBe('Network error during upload')
    // More than the old fixed five, and the budget genuinely spent -- not a count re-derived here.
    expect(put.xhrPut.mock.calls.length).toBeGreaterThan(5)
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(PUT_DEADLINE_MS - 20_000)
  })

  it('a caller deadline shorter than the default is honoured', async () => {
    const put = scriptedPut(['down'], 1000)
    const { t } = transport({ xhrPut: put.xhrPut, reachability: scriptedReach(false) })
    const res = await outcome(t.putWithRetry('u', body, 'image/jpeg', noProgress, undefined, 3000))
    expect('err' in res).toBe(true)
    expect(put.xhrPut.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('an AbortError from the transfer is rethrown untouched, and an already-aborted signal never attempts', async () => {
    const put = scriptedPut(['abort'])
    const { t } = transport({ xhrPut: put.xhrPut })
    const res = await outcome(t.putWithRetry('u', body, 'image/jpeg', noProgress))
    expect('err' in res && (res.err as DOMException).name).toBe('AbortError')
    const pre = new AbortController(); pre.abort()
    const put2 = scriptedPut([{ ok: '' }])
    const { t: t2 } = transport({ xhrPut: put2.xhrPut })
    const res2 = await outcome(t2.putWithRetry('u', body, 'image/jpeg', noProgress, pre.signal))
    expect('err' in res2 && (res2.err as DOMException).name).toBe('AbortError')
    expect(put2.xhrPut).not.toHaveBeenCalled()
  })
})

// ─── relayUploadImage ───────────────────────────────────────────────────────────────────────────

describe('relayUploadImage -- the bytes, through our own Worker', () => {
  it('POSTs to the relay route with every parameter URL-encoded, and returns the server’s own key', async () => {
    const put = scriptedPut([{ ok: '{"key":"relay/k","publicUrl":"https://cdn/relay/k"}' }])
    const { t } = transport({ xhrPut: put.xhrPut })
    const res = await outcome(t.relayUploadImage({ ...RELAY, isThumb: true }, body, noProgress))
    expect('ok' in res && res.ok).toEqual({ key: 'relay/k', publicUrl: 'https://cdn/relay/k' })
    expect(put.calls[0].method).toBe('POST')
    expect(put.calls[0].url).toBe('/api/upload/image-relay?albumId=alb%201&fileName=IMG%20001.jpg&contentType=image%2Fjpeg&isThumb=1')
    expect(put.calls[0].contentType).toBe('image/jpeg')
  })

  it('isThumb=false is sent as 0', async () => {
    const put = scriptedPut([{ ok: '{"key":"k","publicUrl":"u"}' }])
    const { t } = transport({ xhrPut: put.xhrPut })
    await outcome(t.relayUploadImage(RELAY, body, noProgress))
    expect(put.calls[0].url).toMatch(/&isThumb=0$/)
  })

  it('a truncated JSON body is a retryable failure, not a crash', async () => {
    const put = scriptedPut([{ ok: '{"key":' }, { ok: '{"key":"k","publicUrl":"u"}' }])
    const { t } = transport({ xhrPut: put.xhrPut })
    const res = await outcome(t.relayUploadImage(RELAY, body, noProgress))
    expect('ok' in res && res.ok).toEqual({ key: 'k', publicUrl: 'u' })
  })

  it('a 4xx from the relay (rate limited, oversized, disabled) is final', async () => {
    const put = scriptedPut([{ http: 429 }])
    const { t } = transport({ xhrPut: put.xhrPut })
    const res = await outcome(t.relayUploadImage(RELAY, body, noProgress))
    expect('err' in res && (res.err as HttpError).status).toBe(429)
    expect(put.xhrPut).toHaveBeenCalledTimes(1)
  })
})

// ─── putImageWithRelay ──────────────────────────────────────────────────────────────────────────

describe('putImageWithRelay -- direct first, relay behind it', () => {
  it('a direct success returns the ORIGINAL key and never touches the relay', async () => {
    const put = scriptedPut([{ ok: '' }])
    const { t, deps } = transport({ xhrPut: put.xhrPut })
    const res = await outcome(t.putImageWithRelay(ORIGINAL, 'https://r2/signed', RELAY, body, noProgress))
    expect('ok' in res && res.ok).toBe(ORIGINAL)
    expect(put.calls.map((c) => c.method)).toEqual(['PUT'])
    expect(deps.relayPolicy.isRelayBelieved()).toBe(false)
    expect(deps.report).not.toHaveBeenCalled()
  })

  it('a direct NETWORK failure falls back to the relay, returns the RELAY’s key, and records the proof exactly once', async () => {
    // The relay working where the direct path did not is the only evidence this network blocks R2.
    const put = scriptedPut(['down', { ok: '{"key":"relay/k","publicUrl":"https://cdn/relay/k"}' }], 130_000)  // the direct budget is spent in one go
    const { t, deps } = transport({ xhrPut: put.xhrPut, reachability: scriptedReach(false) })
    const res = await outcome(t.putImageWithRelay(ORIGINAL, 'https://r2/signed', RELAY, body, noProgress))
    expect('ok' in res && res.ok).toEqual({ key: 'relay/k', publicUrl: 'https://cdn/relay/k' })
    expect(put.calls.map((c) => c.method)).toEqual(['PUT', 'POST'])
    expect(deps.relayPolicy.isRelayBelieved()).toBe(true)
    expect(deps.report).toHaveBeenCalledTimes(1)
    expect(deps.report).toHaveBeenCalledWith('warn', 'upload:image-relay', expect.stringContaining('relay'), 'alb 1', { fileName: 'IMG 001.jpg' })
  })

  it('a direct HttpError -- R2 itself answered -- is thrown, never relayed', async () => {
    const put = scriptedPut([{ http: 403 }])
    const { t } = transport({ xhrPut: put.xhrPut })
    const res = await outcome(t.putImageWithRelay(ORIGINAL, 'u', RELAY, body, noProgress))
    expect('err' in res && (res.err as HttpError).status).toBe(403)
    expect(put.calls.map((c) => c.method)).toEqual(['PUT'])
  })

  it('once the block is believed, the direct attempt is skipped and the relay is not re-recorded', async () => {
    const put = scriptedPut([{ ok: '{"key":"k","publicUrl":"u"}' }])
    const { t, deps } = transport({ xhrPut: put.xhrPut })
    deps.relayPolicy.recordRelaySucceededAfterDirectFailure()
    await outcome(t.putImageWithRelay(ORIGINAL, 'u', RELAY, body, noProgress))
    expect(put.calls.map((c) => c.method)).toEqual(['POST'])
    expect(deps.report).not.toHaveBeenCalled()
  })

  it('both routes dead: ONE fixed user-facing message, with the two causes riding along as data', async () => {
    // 2026-08-23: this message appeared 23 times for one photographer and said nothing about WHY.
    const put = scriptedPut(['down'], 130_000)
    const { t } = transport({ xhrPut: put.xhrPut, reachability: scriptedReach(false) })
    const res = await outcome(t.putImageWithRelay(ORIGINAL, 'u', RELAY, body, noProgress))
    if (!('err' in res)) throw new Error('resolved')
    const err = res.err as Error & { directCause: string; relayCause: string }
    expect(err.message).toBe("Couldn't upload after trying multiple connection methods. Check that you're connected to the internet, then tap Retry.")
    expect(err.directCause).toBe('Error: Network error during upload')
    expect(err.relayCause).toBe('Error: Network error during upload')
  })

  it('relay-first and the relay dies: directCause says it was skipped', async () => {
    const put = scriptedPut(['down'], 130_000)
    const { t, deps } = transport({ xhrPut: put.xhrPut, reachability: scriptedReach(false) })
    deps.relayPolicy.recordRelaySucceededAfterDirectFailure()
    const res = await outcome(t.putImageWithRelay(ORIGINAL, 'u', RELAY, body, noProgress))
    expect('err' in res && (res.err as { directCause: string }).directCause).toBe('skipped')
  })

  it('the RELAY answering with a refusal is final: its HttpError is thrown as-is, never wrapped as a network failure', async () => {
    // Direct is network-dead; the relay answers 413. That is a verdict with the relay's own reason
    // in it, and the guest must read that -- not "check that you're connected".
    const put = scriptedPut(['down', { http: 413 }], 130_000)
    const { t } = transport({ xhrPut: put.xhrPut, reachability: scriptedReach(false) })
    const res = await outcome(t.putImageWithRelay(ORIGINAL, 'u', RELAY, body, noProgress))
    if (!('err' in res)) throw new Error('resolved')
    expect(res.err).toBeInstanceOf(HttpError)
    expect((res.err as HttpError).status).toBe(413)
    expect(put.calls.map((c) => c.method)).toEqual(['PUT', 'POST'])
  })

  it('a cancel on the RELAY leg is an AbortError too, not the multi-route message', async () => {
    const put = scriptedPut(['down', 'abort'], 130_000)
    const { t } = transport({ xhrPut: put.xhrPut, reachability: scriptedReach(false) })
    const res = await outcome(t.putImageWithRelay(ORIGINAL, 'u', RELAY, body, noProgress))
    expect('err' in res && (res.err as DOMException).name).toBe('AbortError')
    expect(put.calls.map((c) => c.method)).toEqual(['PUT', 'POST'])
  })

  it('a cancel anywhere in the chain surfaces as AbortError, not as the multi-route message', async () => {
    const put = scriptedPut(['abort'])
    const { t } = transport({ xhrPut: put.xhrPut })
    const res = await outcome(t.putImageWithRelay(ORIGINAL, 'u', RELAY, body, noProgress))
    expect('err' in res && (res.err as DOMException).name).toBe('AbortError')
  })
})

// ─── withTimeoutSignal ──────────────────────────────────────────────────────────────────────────

describe('withTimeoutSignal', () => {
  it('aborts with TimeoutError when the budget passes -- the name isNetworkClass keys on', async () => {
    const { signal, cleanup } = withTimeoutSignal(undefined, 1000)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(signal.aborted).toBe(true)
    expect((signal.reason as DOMException).name).toBe('TimeoutError')
    cleanup()
  })

  it('aborts when the CALLER aborts, carrying the caller’s reason', () => {
    const caller = new AbortController()
    const { signal, cleanup } = withTimeoutSignal(caller.signal, 60_000)
    caller.abort(new DOMException('Upload aborted', 'AbortError'))
    expect(signal.aborted).toBe(true)
    expect((signal.reason as DOMException).name).toBe('AbortError')
    cleanup()
  })

  it('an already-aborted caller yields an already-aborted signal', () => {
    const caller = new AbortController(); caller.abort()
    const { signal, cleanup } = withTimeoutSignal(caller.signal, 60_000)
    expect(signal.aborted).toBe(true)
    cleanup()
  })

  it('cleanup() clears the timer and the listener -- one per attempt, per file, otherwise', () => {
    const caller = new AbortController()
    const { signal, cleanup } = withTimeoutSignal(caller.signal, 1000)
    cleanup()
    expect(vi.getTimerCount()).toBe(0)
    caller.abort()
    expect(signal.aborted, 'the caller-abort listener survived cleanup').toBe(false)
  })
})
