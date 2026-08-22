// Robust File→ArrayBuffer read for Android's flaky content-provider references.
//
// Freshly captured camera photos and some gallery picks hand back a File whose bytes are not
// readable for a moment — or intermittently under memory pressure — throwing NotReadableError
// ("The requested file could not be read, typically due to permission problems…"). Two defences:
//   1. Retry with backoff — the media store often finishes writing a just-captured photo a
//      few hundred ms later.
//   2. Fall back to the legacy FileReader API, which succeeds on some Android WebViews where
//      the newer Blob.arrayBuffer() throws on the very same file.
// Reading the bytes into memory once (e.g. to build a stable in-memory File/Blob) is what makes
// every later read — decode, EXIF, the actual upload PUT — immune to the reference going stale.

function readViaFileReader(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as ArrayBuffer)
    fr.onerror = () => reject(fr.error ?? new Error('FileReader failed'))
    fr.readAsArrayBuffer(file)
  })
}

// Read via a blob: object URL. createObjectURL registers the blob's data in the browser's blob
// store, and the loader path (fetch of the blob: URL) frequently succeeds on Android when both
// Blob.arrayBuffer() and FileReader throw NotReadableError on the very same file — it's the same
// path that lets an <img> preview of a freshly-captured photo render even while direct reads fail.
async function readViaObjectUrl(file: Blob): Promise<ArrayBuffer> {
  const url = URL.createObjectURL(file)
  try {
    // A blob: URL is served out of the browser's own blob store and never touches the network, so a
    // failure here means the BYTES are unavailable -- not that anything is wrong with the
    // connection. fetch() reports it as a bare `TypeError: Failed to fetch` regardless, which is
    // the single most misleading string this module can produce, so it is converted before it can
    // escape rather than being pattern-matched back out of a message later.
    const resp = await fetch(url)
    return await resp.arrayBuffer()
  } catch (e) {
    throw asReadFailure(e)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// The message every failure of this module ends up carrying. A prefix on a plain Error rather than
// an Error subclass, because the value has to survive JSON.stringify into the telemetry body and a
// structured-clone across the HEIC worker boundary -- both of which flatten a custom class back to
// a plain object and would silently lose the type.
const READ_FAILURE = 'Could not be read from this device'

// Did this fail because the DEVICE would not hand over the bytes, as opposed to anything about the
// network or the server? Exported so callers classify by asking, instead of re-deriving the answer
// from a substring match that drifts the moment this wording changes.
export function isFileReadFailure(e: unknown): boolean {
  return (e instanceof Error ? e.message : String(e)).startsWith(READ_FAILURE)
}

// Only the original error's NAME is carried through, never its message. The blob-URL attempt fails
// with a bare "Failed to fetch", and letting that text survive is the entire defect this exists to
// close: it made a dead file reference read as a dropped connection everywhere downstream -- in the
// message shown to the guest, in the /admin grouping, and in the classifier that decides whether
// waiting can possibly help. The name is enough to tell NotReadableError from a decode failure when
// reading a report, and it cannot smuggle the wrong story in with it.
function asReadFailure(cause: unknown): Error {
  const name = cause instanceof Error && cause.name ? cause.name : 'Error'
  return new Error(`${READ_FAILURE} (${name})`)
}

export async function readFileRobust(file: Blob, attempts = 5): Promise<ArrayBuffer> {
  // The FIRST error, not the last. The three reads are tried in order of how much they are trusted,
  // so the earliest failure is the one that describes what is actually wrong with the file; the
  // last is always the blob-URL fallback, whose error says nothing except that the fallback also
  // did not work. Keeping the last one is what discarded the real NotReadableError every time.
  let firstErr: unknown
  const remember = (e: unknown) => { if (firstErr === undefined) firstErr = e }

  for (let i = 0; i < attempts; i++) {
    try {
      return await file.arrayBuffer()
    } catch (e) {
      remember(e)
    }
    // Same read via the older API — occasionally succeeds when arrayBuffer() does not.
    try {
      return await readViaFileReader(file)
    } catch (e) {
      remember(e)
    }
    // Last resort: the blob: URL loader path (what makes the photo's preview render even when the
    // two direct reads fail). Kept last because it's the heaviest of the three.
    try {
      return await readViaObjectUrl(file)
    } catch (e) {
      remember(e)
    }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, 250 * (i + 1)))
  }
  throw asReadFailure(firstErr)
}

// Snapshot a picked File into a stable in-memory File. Returns null if the bytes cannot be read
// at all (a permanently dead reference) so callers can surface a clear "re-add the file" error.
export async function snapshotFileRobust(file: File): Promise<File | null> {
  try {
    const buf = await readFileRobust(file)
    return new File([buf], file.name, { type: file.type, lastModified: file.lastModified })
  } catch {
    return null
  }
}
