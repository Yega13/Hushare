import { describe, it, expect } from 'vitest'
import { readFileRobust, isFileReadFailure } from '@/lib/file-read'

// This module decides what a guest is told when their phone will not hand over a photo, and — via
// the message text alone — which recovery the uploader attempts. Both of those were wrong for weeks
// because the wording said "fetch", so the invariants are pinned here rather than trusted.

// The exact expression UploadZone uses to decide "the network went away — park this and wait for it
// to come back". A file-read failure matching this is the original defect: it made a dead file
// reference wait on a connection that was never the problem.
const NETWORK_CLASSIFIER = /failed to fetch|load failed|network request failed|networkerror|network error during upload|couldn't upload after trying multiple connection methods|couldn't reach the server|upload stalled/i

// The expression friendlyUploadError uses to produce "Could not read this file from your device.
// Please remove it and add it again." — the correct, actionable message, which was unreachable
// while these errors were phrased as network failures.
const READ_CLASSIFIER = /could not be read|NotReadableError|NotFoundError|permission problems|object can not be found|did not match the expected pattern|InvalidStateError/i

// A file whose bytes are gone: arrayBuffer() rejects the way Android's content provider does. The
// two later fallbacks (FileReader, blob: URL) are absent in this environment and fail on their own,
// which is exactly the production shape — every read exhausted.
function unreadable(name: string): Blob {
  return {
    arrayBuffer: () => Promise.reject(Object.assign(new Error('boom'), { name })),
  } as unknown as Blob
}

describe('readFileRobust', () => {
  it('blames the device, never the network', async () => {
    const err: Error = await readFileRobust(unreadable('NotReadableError'), 1).catch(e => e)
    expect(err.message).toContain('Could not be read from this device')
    // THE regression. While this was false the file was parked waiting for a connection that was
    // fine, one iPhone sat on it for 24 minutes, and /admin recorded it as a network incident.
    expect(NETWORK_CLASSIFIER.test(err.message)).toBe(false)
    // ...and the message that tells someone what to actually do now reaches them.
    expect(READ_CLASSIFIER.test(err.message)).toBe(true)
  })

  it('keeps the FIRST error, so the blob-URL fallback cannot overwrite the real cause', async () => {
    const err: Error = await readFileRobust(unreadable('NotReadableError'), 1).catch(e => e)
    expect(err.message).toContain('NotReadableError')
    // The last attempt fetches a blob: URL and fails with a bare "Failed to fetch". No trace of
    // that wording may survive — carrying it is what produced 149 mislabelled reports.
    expect(err.message).not.toMatch(/fetch/i)
  })

  it('carries only the original error NAME, never its message', async () => {
    const err: Error = await readFileRobust(unreadable('NotReadableError'), 1).catch(e => e)
    expect(err.message).not.toContain('boom')
  })

  it('still returns the bytes when the file reads normally', async () => {
    const buf = new ArrayBuffer(8)
    const ok = { arrayBuffer: () => Promise.resolve(buf) } as unknown as Blob
    expect(await readFileRobust(ok, 1)).toBe(buf)
  })
})

describe('isFileReadFailure', () => {
  it('recognises its own failures and nothing else', async () => {
    const err = await readFileRobust(unreadable('NotReadableError'), 1).catch(e => e)
    expect(isFileReadFailure(err)).toBe(true)
    // A genuine network failure must stay a network failure — this predicate now decides parking,
    // so a false positive here would park something that needs a different recovery.
    expect(isFileReadFailure(new Error('Failed to fetch (/api/upload/presign)'))).toBe(false)
    expect(isFileReadFailure(new Error('File too large (max 50 MB for videos in this album).'))).toBe(false)
    expect(isFileReadFailure(null)).toBe(false)
  })
})
