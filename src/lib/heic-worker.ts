/// <reference lib="webworker" />
// Runs heic2any in a Web Worker so its WASM decode doesn't block the main thread (a single slow
// HEIC file used to freeze the page for minutes).
//
// heic2any normally needs DOM (document.createElement('canvas')) and the legacy callback-based
// canvas.toBlob API. Neither exists in Workers, so we install a minimal shim BEFORE importing
// heic2any: document.createElement('canvas') returns an OffscreenCanvas with a toBlob shim that
// delegates to convertToBlob. window is aliased to self so heic2any's `window.X` references
// resolve to the worker globals.

type Job = { id: number; buffer: ArrayBuffer }
type Result = { id: number; jpeg?: Blob; error?: string }

type StubElement = {
  style: Record<string, string>
  appendChild: () => void
  getContext: () => null
  src: string
}

function installDomShim() {
  const g = self as unknown as Record<string, unknown>
  if (g.document) return
  g.window = self
  g.document = {
    createElement(tag: string): OffscreenCanvas | StubElement {
      if (tag.toLowerCase() === 'canvas') {
        const oc = new OffscreenCanvas(1, 1)
        // heic2any uses the callback-based toBlob; OffscreenCanvas only exposes the promise-
        // based convertToBlob. Bridge them.
        ;(oc as unknown as { toBlob: (cb: (b: Blob | null) => void, type?: string, quality?: number) => void }).toBlob =
          (cb, type, quality) => {
            oc.convertToBlob({ type, quality }).then(cb).catch(() => cb(null))
          }
        return oc
      }
      // For non-canvas elements (div/span/video used by heic2any for capability detection),
      // return a no-op stub. heic2any never actually attaches these to a tree.
      return { style: {}, appendChild() {}, getContext: () => null, src: '' }
    },
  }
}

type Heic2AnyConverter = (opts: { blob: Blob; toType: string; quality: number }) => Promise<Blob | Blob[]>

let convertFn: Heic2AnyConverter | null = null

async function loadHeic2Any() {
  if (convertFn) return convertFn
  installDomShim()
  const mod = await import('heic2any') as { default: Heic2AnyConverter }
  convertFn = mod.default
  if (!convertFn) throw new Error('heic2any module did not expose default export')
  return convertFn
}

self.addEventListener('message', async (e: MessageEvent<Job>) => {
  const { id, buffer } = e.data
  try {
    const convert = await loadHeic2Any()
    const blob = new Blob([buffer], { type: 'image/heic' })
    const result = await convert({ blob, toType: 'image/jpeg', quality: 0.9 })
    const jpeg = Array.isArray(result) ? result[0] : result
    if (!jpeg) throw new Error('heic2any returned no output')
    const reply: Result = { id, jpeg }
    ;(self as unknown as Worker).postMessage(reply)
  } catch (err) {
    const reply: Result = { id, error: err instanceof Error ? err.message : String(err) }
    ;(self as unknown as Worker).postMessage(reply)
  }
})

export {}
