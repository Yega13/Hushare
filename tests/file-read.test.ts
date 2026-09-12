import { describe, it, expect } from 'vitest'
import { readFileRobust, isFileReadFailure } from '@/lib/file-read'

// This module decides what a guest is told when their phone will not hand over a photo, and — via
// the message text alone — which recovery the uploader attempts. Both of those were wrong for weeks
// because the wording said "fetch", so the invariants are pinned here rather than trusted.

// The classifiers themselves, imported from lib/upload/failure rather than copied: a copy of a
// regex stays green while the real one drifts (rule 17), and both of these were copies until
// 2026-09-10.
import { NETWORK_FAILURE_TEXT as NETWORK_CLASSIFIER, FILE_READ_FAILURE_TEXT as READ_CLASSIFIER } from '@/lib/upload/failure'

// A file whose bytes are gone: arrayBuffer() rejects the way Android's content provider does. The
// two later fallbacks (FileReader, blob: URL) are absent in this environment and fail on their own,
// which is exactly the production shape — every read exhausted.
// A device that hands the file over SUCCESSFULLY and hands over nothing. This is what album
// dm1ybi7j got on 2026-09-12: twelve reads that "worked", twelve empty buffers, twelve zero-byte
// objects in R2 behind twelve green tiles. The photos were gone and nothing reported anything.
function readsEmpty(): Blob {
  return {
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  } as unknown as Blob
}

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

  it('recovers a file that only becomes readable after a moment', async () => {
    // THE camera case, and the one 2.5 seconds of patience was not enough for. A photo taken in the
    // phone's own camera app is handed over as a content:// URI the instant the media-store row
    // exists, while the file behind it is still being written -- so the first reads fail and a
    // later one succeeds. Refusing it is the bug; waiting is the whole fix.
    let calls = 0
    const flaky = {
      arrayBuffer: () => {
        calls++
        return calls < 3
          ? Promise.reject(Object.assign(new Error('not yet'), { name: 'NotReadableError' }))
          : Promise.resolve(new ArrayBuffer(4))
      },
    } as unknown as Blob

    const buf = await readFileRobust(flaky, 4)
    expect(buf.byteLength).toBe(4)
    expect(calls).toBe(3)   // it kept trying rather than giving up on the first refusal
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

describe('a read that succeeds and returns nothing is not a successful read', () => {
  // The defect this closes lost twelve photos. Every layer downstream behaved correctly on the
  // information it had: an empty ArrayBuffer makes a valid 0-byte File, which makes a valid 0-byte
  // Blob, which R2 stores as a valid empty object. Only the read knows the difference.
  it('rejects, rather than handing back an empty buffer', async () => {
    await expect(readFileRobust(readsEmpty(), 1)).rejects.toThrow()
  })

  it('and rejects AS A READ FAILURE, so the file is parked and tried again', async () => {
    // Classified, not just refused. A cloud-backed photo whose bytes have not landed yet is exactly
    // the case the retry loop exists for, and the classification is what buys the second attempt --
    // plus the honest "re-add the file" sentence instead of a story about the network.
    const err = await readFileRobust(readsEmpty(), 1).then(() => null, (e: unknown) => e)
    expect(err, 'an empty read must reject').not.toBeNull()
    expect(isFileReadFailure(err), 'an empty read must classify as a device read failure').toBe(true)
    expect(READ_CLASSIFIER.test((err as Error).message), 'and must match the shared read classifier').toBe(true)
    expect(NETWORK_CLASSIFIER.test((err as Error).message), 'it is NOT a network failure').toBe(false)
    // AND IT SAYS WHICH read failure it was. readFileRobust re-wraps whatever it remembers through
    // asReadFailure, which keeps only the error's NAME -- so raising a plain Error here still
    // arrives correctly classified and arrives saying "(Error)". /admin then cannot tell a file
    // that read as empty from a reference that was dead, which are different problems with
    // different fixes. A mutation that swapped readFailure for a plain Error survived until this
    // line existed.
    expect((err as Error).message, 'the detail must survive to /admin').toContain('empty file')
  })
})
