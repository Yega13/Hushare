import { describe, it, expect } from 'vitest'
import {
  READ_FAILURE_MESSAGE, UNREACHABLE_MESSAGE, VIDEO_UNREACHABLE_MESSAGE, VideoUploadError,
  friendlyUploadError, isDeterministicTusError, isRecoverableNetworkFailure, tusHttpStatus,
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
