// HEIC TO JPEG, THE WAY THE UPLOADER RUNS IT: a Web Worker first, the main thread when that fails.
//
// This was module-level state in UploadZone.tsx with no test: one worker per tab, each reply routed
// back to the photo that asked for it, a two-minute limit per photo, and every waiting photo failed
// at once when the worker crashes -- so the pipeline falls back to the main-thread converter instead
// of leaving a guest's tile on "preparing". It is all timers and bookkeeping, the kind of thing that
// fails without a sound (rule 15), so it lives here now with the browser injected.
//
// MOVED, WITH ONE CHANGE. The worker is fetched AFTER the photo's bytes are read, not before. Before,
// a photo still being read when the worker crashed was then posted to the crashed worker: the crash
// had already failed and cleared every photo it knew about, and this one registered afterwards. If
// that worker never answers again -- which depends on why it failed -- the guest waited out the full
// two minutes before the fallback ran. Reading first posts the photo to whichever worker is current.
//
// NOT MOVED: `new Worker(new URL('../lib/heic-worker.ts', import.meta.url))` and `import('heic2any')`.
// The bundler finds the worker file and the converter chunk only by reading those expressions where
// they are written, so UploadZone passes them in.

/** How long one photo may take in the worker before the pipeline falls back to the main thread. */
export const HEIC_TIMEOUT_MS = 120_000

export type HeicJob = { id: number; buffer: ArrayBuffer }
export type HeicReply = { id: number; jpeg?: Blob; error?: string }

/** The part of a Worker this client uses. A real Worker satisfies it. */
export type HeicWorker = {
  postMessage(message: HeicJob, transfer: Transferable[]): void
  onmessage: ((e: MessageEvent<HeicReply>) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
}

export function createHeicWorkerClient(deps: {
  /** Start the worker. Called again only after a crash. */
  createWorker: () => HeicWorker
  /** lib/file-read's readFileRobust: a picked file can be momentarily unreadable on iOS and Android. */
  readBytes: (blob: Blob) => Promise<ArrayBuffer>
}) {
  let worker: HeicWorker | null = null
  let jobId = 0
  const callbacks = new Map<number, {
    resolve: (b: Blob) => void
    reject: (e: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  function getWorker(): HeicWorker {
    if (worker) return worker
    const created = deps.createWorker()
    created.onmessage = (e) => {
      const { id, jpeg, error } = e.data
      const cb = callbacks.get(id)
      if (!cb) return
      callbacks.delete(id)
      clearTimeout(cb.timer)
      if (jpeg) cb.resolve(jpeg)
      else cb.reject(new Error(error ?? 'HEIC conversion failed'))
    }
    created.onerror = (e) => {
      // HANDLED HERE, SO IT IS NOT REPORTED AGAIN ON THE PAGE. The HTML Standard: "If the event is not
      // canceled, the user agent must act as if the uncaught runtime script error had occurred in the
      // global scope that the Worker object is in" -- which fires window.onerror. Row 1246 (2026-09-13)
      // was exactly that: a Mac on Safari 16 cannot decode HEIC, heic2any's `new Function` was refused
      // inside the worker, and the raw CSP sentence landed in the panel as a page error, while this
      // handler and the main-thread converter behind it were already dealing with the failure.
      e.preventDefault()
      // Null out the worker -- the next file gets a fresh one. No permanent broken flag: a transient
      // crash (e.g. OOM on one large file) should not disable the worker for later, smaller files.
      for (const [, cb] of callbacks) { clearTimeout(cb.timer); cb.reject(new Error('HEIC worker crashed')) }
      callbacks.clear()
      worker = null
    }
    worker = created
    return created
  }

  async function convert(file: File): Promise<Blob> {
    const id = ++jobId
    // Read first, then fetch the worker -- see the header for why the order matters.
    const buffer = await deps.readBytes(file)
    const target = getWorker()
    return new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(() => {
        callbacks.delete(id)
        reject(new Error('HEIC conversion timed out'))
      }, HEIC_TIMEOUT_MS)
      callbacks.set(id, { resolve, reject, timer })
      target.postMessage({ id, buffer }, [buffer])
    })
  }

  return { convert }
}

type Heic2Any = (opts: { blob: Blob; toType: string; quality: number }) => Promise<Blob | Blob[]>

/** The main-thread converter. `load` is `() => import('heic2any')`, written where the bundler can see it. */
export async function convertHeicWith(load: () => Promise<{ default: unknown }>, file: File): Promise<Blob> {
  const heic2any = (await load()).default as Heic2Any
  if (typeof heic2any !== 'function') throw new Error('heic2any failed to load')
  const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
  return Array.isArray(result) ? result[0] : result
}
