import { describe, it, expect, vi, afterEach } from 'vitest'
import { xhrPut, readJson, readWithin, BODY_READ_TIMEOUT_MS, HttpError, STALL_TIMEOUT_MS, type XhrLike } from '@/lib/upload/http'
import { isNetworkClass } from '@/lib/upload-policy'
import { FETCH_ATTEMPT_TIMEOUT_MS } from '@/lib/upload/retry'
import { IMMUTABLE_CACHE_CONTROL } from '@/lib/media'

// THE FUNCTION THAT CARRIES A GUEST'S PHOTO BYTES OFF THEIR PHONE, tested for the first time.
//
// Every retry loop in the upload path sits on xhrPut. It lived at module scope in UploadZone.tsx and
// was unreachable from a test. The fake below implements exactly the XhrLike surface the function
// drives, so each test can script one request: headers it set, progress it received, how it ended.

function fakeXhr(status = 200, responseText = '') {
  const headers: Record<string, string> = {}
  const calls = { open: [] as string[], sent: null as Blob | null, aborted: 0 }
  const xhr: XhrLike & { fire: { progress(l: number, t: number, computable?: boolean): void; uploaded(): void; load(): void; error(): void } } = {
    status, responseText,
    upload: { onprogress: null, onload: null },
    onload: null, onerror: null,
    open: (m, u) => { calls.open.push(`${m} ${u}`) },
    setRequestHeader: (k, v) => { headers[k] = v },
    send: (b) => { calls.sent = b },
    abort: () => { calls.aborted++ },
    fire: {
      // A three-field stand-in cast to ProgressEvent: the fake is the thing pretending, so the cast lives here.
      progress: (loaded, total, computable = true) => xhr.upload.onprogress?.({ lengthComputable: computable, loaded, total } as ProgressEvent),
      uploaded: () => xhr.upload.onload?.({} as ProgressEvent),
      load: () => xhr.onload?.({} as ProgressEvent),
      error: () => xhr.onerror?.({} as ProgressEvent),
    },
  }
  return { xhr, headers, calls }
}

const body = new Blob(['x'])
const run = (f: ReturnType<typeof fakeXhr>, method: 'PUT' | 'POST' = 'PUT', signal?: AbortSignal, onProgress: (pct: number) => void = () => {}) =>
  xhrPut(method, 'https://r2/key', body, 'image/jpeg', onProgress, signal, () => f.xhr)

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('a successful PUT', () => {
  it('sends the body and resolves with the response text', async () => {
    const f = fakeXhr(200, '')
    const p = run(f)
    f.xhr.fire.load()
    await expect(p).resolves.toBe('')
    expect(f.calls.open).toEqual(['PUT https://r2/key'])
    expect(f.calls.sent).toBe(body)
  })

  it('sets Content-Type, and on a PUT the EXACT Cache-Control the server signed', async () => {
    // The presigned PUT signature binds this header. One byte different and R2 answers
    // SignatureDoesNotMatch for every upload. Both sides import the one definition in lib/media.
    const f = fakeXhr()
    const p = run(f, 'PUT'); f.xhr.fire.load(); await p
    expect(f.headers['Content-Type']).toBe('image/jpeg')
    expect(f.headers['Cache-Control']).toBe(IMMUTABLE_CACHE_CONTROL)
  })

  it('does NOT send Cache-Control on a relay POST -- the relay sets storage headers itself', async () => {
    const f = fakeXhr(200, '{"key":"k","publicUrl":"u"}')
    const p = run(f, 'POST'); f.xhr.fire.load()
    await expect(p).resolves.toBe('{"key":"k","publicUrl":"u"}')
    expect(f.headers['Cache-Control']).toBeUndefined()
    // The relay route exports only POST; opened as a PUT it would answer 405 to every relay upload.
    expect(f.calls.open, 'the relay POST was opened as a PUT').toEqual(['POST https://r2/key'])
  })

  it('reports progress as a rounded percentage, and only when the length is computable', async () => {
    const f = fakeXhr()
    const seen: number[] = []
    const p = run(f, 'PUT', undefined, (pct) => seen.push(pct))
    f.xhr.fire.progress(333, 1000)
    f.xhr.fire.progress(500, 1000, false)
    f.xhr.fire.progress(1000, 1000)
    f.xhr.fire.load(); await p
    expect(seen).toEqual([33, 100])
  })
})

describe('how it fails, and that each failure is a DIFFERENT kind', () => {
  it('a 4xx with a JSON body rejects with an HttpError carrying the server’s own reason', async () => {
    // The retry loops treat HttpError with status < 500 as FINAL: no amount of waiting fixes a
    // signature or size refusal. The relay explains itself in JSON, and that text reaches the guest.
    const f = fakeXhr(413, '{"error":"That photo is larger than this album allows"}')
    const p = run(f, 'POST'); f.xhr.fire.load()
    await expect(p).rejects.toBeInstanceOf(HttpError)
    await expect(p).rejects.toMatchObject({ status: 413, message: 'That photo is larger than this album allows' })
  })

  it('treats exactly 200-299 as success: 299 resolves, 300 rejects', async () => {
    // No test sat on the boundary, and a mutation widening it to `<= 300` survived. XHR follows
    // redirects itself so a 3xx is nearly unreachable here -- which is precisely why it would never
    // be noticed if the window drifted.
    const ok = fakeXhr(299, 'fine'); const p1 = run(ok); ok.xhr.fire.load()
    await expect(p1).resolves.toBe('fine')
    const redirect = fakeXhr(300, ''); const p2 = run(redirect); redirect.xhr.fire.load()
    await expect(p2).rejects.toMatchObject({ status: 300 })
    const early = fakeXhr(199, ''); const p3 = run(early); early.xhr.fire.load()
    await expect(p3).rejects.toMatchObject({ status: 199 })
  })

  it('a 5xx with a non-JSON body keeps the generic message rather than throwing on the parse', async () => {
    // R2 answers PUT errors in XML. JSON.parse of that must not become the error the guest sees.
    const f = fakeXhr(503, '<Error><Code>SlowDown</Code></Error>')
    const p = run(f, 'PUT'); f.xhr.fire.load()
    await expect(p).rejects.toMatchObject({ status: 503, message: 'R2 PUT 503' })
  })

  it('a network error is a plain Error, NOT an HttpError -- the loops wait for the connection on this one', async () => {
    const f = fakeXhr()
    const p = run(f); f.xhr.fire.error()
    await expect(p).rejects.toThrow('Network error during upload')
    await expect(p).rejects.not.toBeInstanceOf(HttpError)
  })

  it('a signal that is already aborted rejects at once and never builds a request', async () => {
    const f = fakeXhr()
    const ctrl = new AbortController(); ctrl.abort()
    await expect(run(f, 'PUT', ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.calls.open).toEqual([])
  })

  it('an abort mid-flight cancels the request and rejects as AbortError, exactly once', async () => {
    const f = fakeXhr()
    const ctrl = new AbortController()
    const p = run(f, 'PUT', ctrl.signal)
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.calls.aborted).toBe(1)
    // A late load after settling must not resurrect anything.
    f.xhr.fire.load()
    expect(f.calls.aborted).toBe(1)
  })
})

describe('the stall watchdog', () => {
  it('aborts a request that shows no progress for STALL_TIMEOUT_MS', async () => {
    // Weak-signal mobile: the socket opens and then nothing moves. Without this the guest waits
    // forever; with it the retry loop reconnects.
    vi.useFakeTimers()
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const f = fakeXhr()
    const p = run(f)
    const rejected = p.catch((e: Error) => e)
    clock = STALL_TIMEOUT_MS
    await vi.advanceTimersByTimeAsync(4000)
    expect(f.calls.aborted).toBe(1)
    await expect(rejected).resolves.toMatchObject({ message: 'Upload stalled — retrying' })
  })

  it('progress resets the watchdog, so a slow-but-moving upload is never aborted', async () => {
    vi.useFakeTimers()
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const f = fakeXhr()
    const p = run(f)
    for (let i = 0; i < 10; i++) {
      clock += 4000
      f.xhr.fire.progress(i * 100, 1000)
      await vi.advanceTimersByTimeAsync(4000)
    }
    expect(f.calls.aborted, 'a moving upload was aborted as stalled').toBe(0)
    f.xhr.fire.load(); await p
  })

  it('a request that has SETTLED is disarmed: no stall abort fires afterwards', async () => {
    // xhrPut has no `settled` flag; the claim in its place is that finish() disarms the watchdog.
    // This is that claim, tested: a completed request left alone for far longer than the stall
    // threshold is never aborted.
    vi.useFakeTimers()
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const f = fakeXhr()
    const p = run(f)
    f.xhr.fire.load(); await p
    clock = STALL_TIMEOUT_MS * 3
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS * 3)
    expect(f.calls.aborted, 'the watchdog outlived the request it was watching').toBe(0)
    expect(vi.getTimerCount(), 'a stall timer was left running after the request settled').toBe(0)
  })

  it('a request that has SETTLED is disarmed: a later caller abort no longer touches it', async () => {
    // The other half of what finish() disarms: the abort listener. After a success, the caller
    // tearing down its controller must not call abort() on a request that already completed.
    const f = fakeXhr()
    const ctrl = new AbortController()
    const p = run(f, 'PUT', ctrl.signal)
    f.xhr.fire.load(); await p
    ctrl.abort()
    expect(f.calls.aborted, 'the abort listener outlived the request').toBe(0)
  })

  it('"body fully sent" also resets it, so a slow server response is not mistaken for a stall', async () => {
    vi.useFakeTimers()
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const f = fakeXhr()
    const p = run(f)
    clock = STALL_TIMEOUT_MS - 1000
    f.xhr.fire.uploaded()           // bytes are all out; waiting on R2 to answer
    clock = STALL_TIMEOUT_MS + 3000 // 4s after the reset -- well under the threshold from THAT point
    await vi.advanceTimersByTimeAsync(4000)
    expect(f.calls.aborted).toBe(0)
    f.xhr.fire.load(); await p
  })
})

describe('readJson', () => {
  const res = (text: string) => ({ text: async () => text }) as unknown as Response
  it('parses a body', async () => { expect(await readJson<{ a: number }>(res('{"a":1}'))).toEqual({ a: 1 }) })
  it('turns an EMPTY body into a retryable, readable error -- not "Unexpected end of JSON input"', async () => {
    await expect(readJson(res(''))).rejects.toThrow('Empty response from the server — please retry')
  })
  it('turns a truncated body into a readable error', async () => {
    await expect(readJson(res('{"a":'))).rejects.toThrow('Incomplete response from the server — please retry')
  })
})

describe('HttpError', () => {
  it('is an Error with a status and its own name', () => {
    const e = new HttpError(429, 'slow down')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('HttpError')
    expect(e.status).toBe(429)
    expect(e.message).toBe('slow down')
  })
})

describe('a body that never arrives', () => {
  // THE SILENT FREEZE. lib/upload/retry cleans up its per-attempt signal the moment the Response is
  // returned -- timer cleared, abort listener removed, no abort -- so the body that arrives after
  // that is bounded by nothing and deaf to Cancel. A response whose headers came and whose body then
  // stalled left this await pending forever: the upload slot was never released, the tile sat on
  // "preparing", saver.finish() was never reached, and NOTHING was reported. Six freeze the uploader.
  const stalledBody = () => new Response(new ReadableStream({ start() { /* never enqueues, never closes */ } }))

  afterEach(() => { vi.useRealTimers() })

  it('resolves what arrives in time, and leaves no timer behind', async () => {
    vi.useFakeTimers()
    await expect(readWithin(Promise.resolve('body'), 1000)).resolves.toBe('body')
    expect(vi.getTimerCount(), 'an uncleared timer holds a rejection nobody will ever read').toBe(0)
  })

  it('rejects with the TimeoutError the PARK decision keys on, not a generic error', async () => {
    vi.useFakeTimers()
    const settled = readWithin(new Promise<string>(() => {})).then(() => 'resolved', (e: unknown) => e)
    await vi.advanceTimersByTimeAsync(BODY_READ_TIMEOUT_MS)
    const err = await settled
    expect(err).toBeInstanceOf(DOMException)
    expect((err as DOMException).name).toBe('TimeoutError')
    // The whole reason for that name: the file parks and auto-resumes like any dead connection,
    // with no new concept anywhere in the upload path.
    expect(isNetworkClass(err), 'a stalled body must be network-class').toBe(true)
  })

  it('gives a body the same patience as the request that fetched it', () => {
    // The comment says "matched to FETCH_ATTEMPT_TIMEOUT_MS", which is a claim, so it is asserted.
    expect(BODY_READ_TIMEOUT_MS).toBe(FETCH_ATTEMPT_TIMEOUT_MS)
  })

  it('readJson on a stalled body rejects instead of holding the upload slot forever', async () => {
    vi.useFakeTimers()
    const settled = readJson(stalledBody()).then(() => 'resolved', (e: unknown) => (e as Error).name)
    await vi.advanceTimersByTimeAsync(BODY_READ_TIMEOUT_MS)
    expect(await settled).toBe('TimeoutError')
  })

  it('...and a body that arrives late but within the budget is still read', async () => {
    vi.useFakeTimers()
    const slow = new Response(new ReadableStream({
      start(c) { setTimeout(() => { c.enqueue(new TextEncoder().encode('{"ok":true}')); c.close() }, BODY_READ_TIMEOUT_MS - 1000) },
    }))
    const read = readJson<{ ok: boolean }>(slow)
    await vi.advanceTimersByTimeAsync(BODY_READ_TIMEOUT_MS)
    expect(await read).toEqual({ ok: true })
  })
})
