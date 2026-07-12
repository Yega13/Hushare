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
    const resp = await fetch(url)
    return await resp.arrayBuffer()
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function readFileRobust(file: Blob, attempts = 5): Promise<ArrayBuffer> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await file.arrayBuffer()
    } catch (e) {
      lastErr = e
    }
    // Same read via the older API — occasionally succeeds when arrayBuffer() does not.
    try {
      return await readViaFileReader(file)
    } catch (e) {
      lastErr = e
    }
    // Last resort: the blob: URL loader path (what makes the photo's preview render even when the
    // two direct reads fail). Kept last because it's the heaviest of the three.
    try {
      return await readViaObjectUrl(file)
    } catch (e) {
      lastErr = e
    }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, 250 * (i + 1)))
  }
  throw lastErr instanceof Error ? lastErr : new Error('File could not be read')
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
