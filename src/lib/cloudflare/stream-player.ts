// Cloudflare Stream player SDK loader — used to unmute autoplaying lightbox videos and
// set a comfortable starting volume. The Stream iframe URL supports `autoplay` and `muted`
// params but NOT volume, so controlling volume requires the postMessage-based SDK.
//
// We keep the iframe muted in its URL (browsers only allow muted autoplay without a direct
// gesture), let playback start, then unmute to a set volume here. The lightbox is opened by
// a user tap, so the document has user activation and the programmatic unmute is honoured.
// Every failure path is swallowed: if the SDK can't load, the video simply stays muted.

const SDK_SRC = 'https://embed.videodelivery.net/embed/sdk.latest.js'

type StreamPlayer = {
  muted: boolean
  volume: number
  play?: () => Promise<void> | void
  pause?: () => void
  addEventListener?: (event: string, cb: () => void) => void
  removeEventListener?: (event: string, cb: () => void) => void
}
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

export type StreamController = {
  toggle: () => void
  destroy: () => void
}

// Build a controller for a Stream iframe so the lightbox can drive play/pause from its own
// tap overlay (needed because the iframe swallows touch, so we can't rely on the native button
// while also supporting swipe). Sets a starting volume, unmutes when autoplaying, and reports
// play/pause back so the caller can reflect state. Returns null if the SDK can't load.
export async function createStreamController(
  iframe: HTMLIFrameElement,
  opts: { volume?: number; autoplay?: boolean; onPlayingChange?: (playing: boolean) => void },
): Promise<StreamController | null> {
  try {
    const StreamFactory = await loadStreamSdk()
    if (!StreamFactory) return null
    const player = StreamFactory(iframe)
    player.volume = Math.min(1, Math.max(0, opts.volume ?? 0.5))
    if (opts.autoplay) player.muted = false
    // Track playing state from the player's own events rather than reading `.paused`, which is
    // not reliably synchronous across the postMessage bridge.
    let playing = !!opts.autoplay
    const onPlay = () => { playing = true; opts.onPlayingChange?.(true) }
    const onPause = () => { playing = false; opts.onPlayingChange?.(false) }
    player.addEventListener?.('play', onPlay)
    player.addEventListener?.('pause', onPause)
    return {
      toggle: () => { if (playing) player.pause?.(); else void player.play?.() },
      destroy: () => {
        player.removeEventListener?.('play', onPlay)
        player.removeEventListener?.('pause', onPause)
      },
    }
  } catch {
    return null
  }
}
