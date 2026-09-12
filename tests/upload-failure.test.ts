import { describe, it, expect } from 'vitest'
import {
  READ_FAILURE_MESSAGE, UNREACHABLE_MESSAGE, VIDEO_UNREACHABLE_MESSAGE, VideoUploadError,
  friendlyUploadError, isDeterministicTusError, isRecoverableNetworkFailure, tusHttpStatus, refusalFrom, refusalFields,
} from '@/lib/upload/failure'
import { HttpError } from '@/lib/upload/http'
import { readFileRobust } from '@/lib/file-read'

// WHAT A FAILED UPLOAD MEANS: park and wait for the network, or fail with Retry, and what the
// guest reads. An unrecognised failure must stay an error: parking something that can never
// succeed leaves a tile claiming to wait for a network that was never the problem.

const tusError = (status: number | null) => Object.assign(new Error('tus: request failed'), {
  originalResponse: status === null ? null : { getStatus: () => status },
})
const unreadable = (name: string): Blob => ({ arrayBuffer: () => Promise.reject(Object.assign(new Error('boom'), { name })) } as unknown as Blob)

describe('tusHttpStatus', () => {
  it('reads the status out of a DetailedError, and null when no response ever arrived', () => {
    expect(tusHttpStatus(tusError(413))).toBe(413)
    expect(tusHttpStatus(tusError(null))).toBeNull()
    expect(tusHttpStatus(new Error('plain'))).toBeNull()
    expect(tusHttpStatus(Object.assign(new Error('x'), { originalResponse: { getStatus: () => 0 } }))).toBeNull()
  })
  it('a 4xx is deterministic; a 5xx or no response is not', () => {
    expect(isDeterministicTusError(tusError(410))).toBe(true)
    expect(isDeterministicTusError(tusError(500))).toBe(false)
    expect(isDeterministicTusError(tusError(null))).toBe(false)
  })
})

describe('isRecoverableNetworkFailure -- what parks', () => {
  it('a deliberate cancel never parks', () => {
    expect(isRecoverableNetworkFailure(new DOMException('cancelled', 'AbortError'))).toBe(false)
    // ...even when the browser words the abort like a network drop.
    expect(isRecoverableNetworkFailure(new DOMException('Load failed', 'AbortError'))).toBe(false)
  })
  it('a server that answered, even badly, is not the network', () => {
    expect(isRecoverableNetworkFailure(new HttpError(500, 'Failed to fetch the thing'))).toBe(false)
  })
  it('a video with no HTTP status on any attempt is the network; one with a 413 is not', () => {
    expect(isRecoverableNetworkFailure(new VideoUploadError('tus: failed', null, null))).toBe(true)
    expect(isRecoverableNetworkFailure(new VideoUploadError('tus: failed', null, 413))).toBe(false)
  })
  it('a refusal the product made on purpose is not the network, whatever else its text says', () => {
    expect(isRecoverableNetworkFailure(new Error('File too large: failed to fetch'))).toBe(false)
    expect(isRecoverableNetworkFailure(new Error('Unsupported video codec, load failed'))).toBe(false)
    // ANCHORED: the refusal is how the message STARTS. A server blob that merely mentions an
    // unsupported something is not a refusal of ours, and must still park.
    expect(isRecoverableNetworkFailure(new Error('tus: 500, body: unsupported media type, Load failed'))).toBe(true)
  })
  it('a file the device would not hand over PARKS (a second attempt is what saves it)', async () => {
    const err: unknown = await readFileRobust(unreadable('NotReadableError'), 1).catch((e) => e)
    expect(isRecoverableNetworkFailure(err)).toBe(true)
  })
  it('the network text shapes park; anything unrecognised stays an error', () => {
    for (const text of ['Failed to fetch', 'Load failed', 'NetworkError when attempting', 'Upload stalled for 30s', "Couldn't reach the server"]) {
      expect(isRecoverableNetworkFailure(new Error(text)), text).toBe(true)
    }
    expect(isRecoverableNetworkFailure(new Error('Something odd happened'))).toBe(false)
    expect(isRecoverableNetworkFailure('a string')).toBe(false)
  })
  it("the product's own 'Upload failed' / 'Video upload failed' is NOT Safari's 'Load failed' (it contains it)", () => {
    // Found while writing these tests: a generic failure was parked as a network drop.
    expect(isRecoverableNetworkFailure(new Error('Video upload failed'))).toBe(false)
    expect(isRecoverableNetworkFailure(new Error('Upload failed'))).toBe(false)
    expect(isRecoverableNetworkFailure(new Error('Load failed'))).toBe(true)
    expect(friendlyUploadError(new Error('Video upload failed'))).toBe('Video upload failed')
  })
})

describe('friendlyUploadError -- what the guest reads', () => {
  it('a dead file reference names the device, not the network, and is not a network failure', async () => {
    const err: Error = await readFileRobust(unreadable('NotReadableError'), 1).catch((e) => e)
    expect(friendlyUploadError(err)).toBe(READ_FAILURE_MESSAGE)
    // THE regression: while this classified as network, an iPhone sat parked on it for 24 minutes.
    expect(friendlyUploadError(err)).not.toBe(UNREACHABLE_MESSAGE)
  })
  it('an exhausted fetch points at the network the guest can change', () => {
    expect(friendlyUploadError(new Error('Failed to fetch'))).toBe(UNREACHABLE_MESSAGE)
    expect(friendlyUploadError(new Error('Load failed'))).toBe(UNREACHABLE_MESSAGE)
  })
  it('a video answer names its status: 413, another 4xx, a 5xx', () => {
    expect(friendlyUploadError(new VideoUploadError('x', null, 413))).toBe('This video is too large to upload.')
    expect(friendlyUploadError(new VideoUploadError('x', null, 422))).toContain('HTTP 422')
    expect(friendlyUploadError(new VideoUploadError('x', null, 422))).toContain('rejected')
    expect(friendlyUploadError(tusError(503))).toContain('HTTP 503')
    expect(friendlyUploadError(tusError(503))).toContain('continues where it left off')
  })
  it('a video with no answer on any path says so, without blaming one network', () => {
    expect(friendlyUploadError(new VideoUploadError('x', null, null))).toBe(VIDEO_UNREACHABLE_MESSAGE)
    expect(friendlyUploadError(new Error('tus: request failed'))).toBe(VIDEO_UNREACHABLE_MESSAGE)
    expect(friendlyUploadError(new Error('Upload stalled'))).toBe(VIDEO_UNREACHABLE_MESSAGE)
  })
  it('an unknown message is shown as-is, cut to 160 characters; a non-Error is "Upload failed"', () => {
    const long = 'x'.repeat(200)
    expect(friendlyUploadError(new Error(long))).toBe('x'.repeat(157) + '…')
    expect(friendlyUploadError(new Error('short and odd'))).toBe('short and odd')
    expect(friendlyUploadError('nope')).toBe('Upload failed')
  })
})

describe('a control-plane call that no attempt ever reached', () => {
  // lib/upload/retry hands its own verdict on as `unreachable`. When every attempt timed out, the
  // TEXT of that failure is "Timed out (/api/...)" -- no network phrase at all -- so before the flag
  // existed such a photo was never parked for the reconnect, and the guest read our endpoint name.
  const timedOut = (unreachable: boolean) => Object.assign(new Error('Timed out (/api/upload/presign)'), { unreachable })

  it('parks when the loop says the network never answered', () => {
    expect(isRecoverableNetworkFailure(timedOut(true))).toBe(true)
  })
  it('and it is the verdict that parks, not the words: the same text without it stays an error', () => {
    expect(isRecoverableNetworkFailure(timedOut(false))).toBe(false)
    expect(isRecoverableNetworkFailure(new Error('Timed out (/api/upload/presign)'))).toBe(false)
  })
  it('only the verdict itself counts, not any truthy value', () => {
    expect(isRecoverableNetworkFailure(Object.assign(new Error('x'), { unreachable: 'yes' }))).toBe(false)
  })
  it('a cancel stays a cancel, and a server answer stays an answer, whatever else is attached', () => {
    expect(isRecoverableNetworkFailure(Object.assign(new DOMException('x', 'AbortError'), { unreachable: true }))).toBe(false)
    expect(isRecoverableNetworkFailure(Object.assign(new HttpError(500, 'x'), { unreachable: true }))).toBe(false)
  })
  it('the guest is told to change network, not shown our endpoint', () => {
    expect(friendlyUploadError(timedOut(true))).toBe(UNREACHABLE_MESSAGE)
    expect(friendlyUploadError(timedOut(false))).toBe('Timed out (/api/upload/presign)')
  })
})

describe('refusalFrom -- a refusal keeps what it was', () => {
  const res = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

  it("carries the server's words, code and nudge", async () => {
    const e = await refusalFrom(res(429, { code: 'album_full', nudge: 'upgrade', error: "You've reached this album's upload limit. Upgrade your plan for more space." }), 'Presign failed')
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toBe("You've reached this album's upload limit. Upgrade your plan for more space.")
    expect(e.code).toBe('album_full')
    expect(e.nudge).toBe('upgrade')
  })
  it('names the step and the status when the body says nothing usable', async () => {
    expect((await refusalFrom(res(502, 'not json'), 'Presign failed')).message).toBe('Presign failed (502)')
    expect((await refusalFrom(res(500, { error: '' }), 'Save failed')).message).toBe('Save failed (500)')
    expect((await refusalFrom(res(500, { error: 42 }), 'Save failed')).message).toBe('Save failed (500)')
  })
  it('drops a code or nudge that is not a string, rather than handing the banner garbage', async () => {
    const e = await refusalFrom(res(429, { error: 'x', code: 7, nudge: { a: 1 } }), 'Save failed')
    expect(e.message).toBe('x')
    expect(e.code).toBeUndefined()
    expect(e.nudge).toBeUndefined()
  })
})

describe('refusalFields -- what a refusal carries, read off an unknown error', () => {
  // By the time a failure reaches the uploader's catch it is `unknown`, and the same two narrowings
  // were written twice there: one raised the banner, the other filed the report. This is the reader
  // both use, so they cannot disagree about what counts as a code.
  it('reads the code and the nudge a refusal was built with', () => {
    const e = Object.assign(new Error('full'), { code: 'album_full', nudge: 'register' })
    expect(refusalFields(e)).toEqual({ code: 'album_full', nudge: 'register' })
  })

  it('a value that is not a string is not a code -- anything truthy would raise the wrong banner', () => {
    expect(refusalFields(Object.assign(new Error('x'), { code: 7, nudge: { a: 1 } }))).toEqual({ code: undefined, nudge: undefined })
    expect(refusalFields(Object.assign(new Error('x'), { code: true }))).toEqual({ code: undefined, nudge: undefined })
  })

  it('an ordinary failure carries neither, and nothing throws on null or a string', () => {
    expect(refusalFields(new Error('Failed to fetch'))).toEqual({ code: undefined, nudge: undefined })
    expect(refusalFields(null)).toEqual({ code: undefined, nudge: undefined })
    expect(refusalFields('nope')).toEqual({ code: undefined, nudge: undefined })
  })

  it('what refusalFrom attaches is what this reads back', () => {
    // The pair that matters: the two functions are the write and the read of one contract.
    const body = { code: 'album_full', nudge: 'upgrade', error: 'You have reached this album upload limit.' }
    return refusalFrom(new Response(JSON.stringify(body), { status: 403 }), 'Presign failed').then((e) => {
      expect(refusalFields(e)).toEqual({ code: 'album_full', nudge: 'upgrade' })
    })
  })
})
