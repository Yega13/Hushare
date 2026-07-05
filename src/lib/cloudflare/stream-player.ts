// Cloudflare Stream player SDK loader — used to unmute autoplaying lightbox videos and
// set a comfortable starting volume. The Stream iframe URL supports `autoplay` and `muted`
// params but NOT volume, so controlling volume requires the postMessage-based SDK.
//
// We keep the iframe muted in its URL (browsers only allow muted autoplay without a direct
// gesture), let playback start, then unmute to a set volume here. The lightbox is opened by
// a user tap, so the document has user activation and the programmatic unmute is honoured.
// Every failure path is swallowed: if the SDK can't load, the video simply stays muted.

const SDK_SRC = 'https://embed.videodelivery.net/embed/sdk.latest.js'

type StreamPlayer = { muted: boolean; volume: number; paused?: boolean; play?: () => void; pause?: () => void }
type StreamFactory = (iframe: HTMLIFrameElement) => StreamPlayer

let sdkPromise: Promise<StreamFactory | null> | null = null

function loadStreamSdk(): Promise<StreamFactory | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  const existing = (window as unknown as { Stream?: StreamFactory }).Stream
  if (existing) return Promise.resolve(existing)
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise<StreamFactory | null>((resolve) => {
    const script = document.createElement('script')
    script.src = SDK_SRC
    script.async = true
    script.onload = () => resolve((window as unknown as { Stream?: StreamFactory }).Stream ?? null)
    script.onerror = () => { sdkPromise = null; resolve(null) }
    document.head.appendChild(script)
  })
  return sdkPromise
}

// Toggle play/pause on a Stream iframe (used by the lightbox tap gesture). No-op on failure.
export async function toggleStreamPlayback(iframe: HTMLIFrameElement): Promise<void> {
  try {
    const StreamFactory = await loadStreamSdk()
    if (!StreamFactory) return
    const player = StreamFactory(iframe)
    if (player.paused) player.play?.()
    else player.pause?.()
  } catch {
    // SDK/init failed — leave playback as-is.
  }
}

// Unmute the given Stream iframe and set its volume (0–1). No-op on any failure.
export async function unmuteStreamVideo(iframe: HTMLIFrameElement, volume = 0.5): Promise<void> {
  try {
    const StreamFactory = await loadStreamSdk()
    if (!StreamFactory) return
    const player = StreamFactory(iframe)
    player.volume = Math.min(1, Math.max(0, volume))
    player.muted = false
  } catch {
    // SDK/init failed — leave the video muted (its URL already has muted=true).
  }
}
