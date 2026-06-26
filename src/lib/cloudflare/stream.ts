const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'

type StreamUploadInit = {
  uploadUrl: string
  streamUid: string
  iframeUrl: string
  thumbnailUrl: string
}

// Single source of truth for stream video URL templates.
// Import this in any route that stores or reconstructs stream URLs.
export function streamVideoUrls(uid: string): {
  url: string
  stream_iframe_url: string
  stream_thumbnail_url: string
} {
  return {
    url: `https://iframe.videodelivery.net/${uid}`,
    stream_iframe_url: `https://iframe.videodelivery.net/${uid}`,
    stream_thumbnail_url: `https://videodelivery.net/${uid}/thumbnails/thumbnail.jpg?time=1s&height=720&fit=clip`,
  }
}

function safeBase64(str: string): string {
  // btoa only handles Latin-1. Use Buffer on Node.js, encodeURIComponent fallback for edge.
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64')
  }
  // Encode UTF-8 bytes so every character is Latin-1 safe before passing to btoa
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1: string) =>
    String.fromCharCode(parseInt(p1, 16)),
  ))
}

function sanitizeFileName(name: string): string {
  // Strip control characters and limit length to prevent header overflow
  return name.replace(/[\x00-\x1f\x7f]/g, '_').slice(0, 200)
}

export async function createStreamUpload(
  fileSizeBytes: number,
  fileName: string,
): Promise<StreamUploadInit> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_STREAM_TOKEN

  if (!accountId || !token) {
    throw new Error('Missing Cloudflare Stream credentials')
  }

  const safeName = sanitizeFileName(fileName)

  const res = await fetch(
    `${CLOUDFLARE_API}/accounts/${accountId}/stream?direct_user=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(fileSizeBytes),
        'Upload-Metadata': `name ${safeBase64(safeName)}`,
      },
    },
  )

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // Log the raw body at warn level for debugging but keep it out of the thrown Error
    // message — CF API error bodies sometimes echo the Authorization token back.
    console.warn(`[stream] init failed status=${res.status} body=${body.slice(0, 200)}`)
    throw new Error(`Stream init failed: ${res.status}`)
  }

  const uploadUrl = res.headers.get('Location')
  const streamUid = res.headers.get('stream-media-id')

  if (!uploadUrl || !streamUid) {
    throw new Error('Stream response missing Location or stream-media-id')
  }

  // Guard against a compromised or misconfigured Cloudflare API returning an upload URL
  // that points somewhere other than videodelivery.net — the client should never TUS-upload
  // to an attacker-controlled endpoint.
  if (!uploadUrl.startsWith('https://upload.videodelivery.net/')) {
    throw new Error(`Unexpected Stream upload URL origin: ${uploadUrl.slice(0, 80)}`)
  }

  // Validate UID format — wrong format here produces malformed URLs in every downstream consumer
  if (!/^[a-f0-9]{32}$/.test(streamUid)) {
    throw new Error(`Unexpected stream-media-id format: ${streamUid}`)
  }

  const urls = streamVideoUrls(streamUid)
  return {
    uploadUrl,
    streamUid,
    iframeUrl: urls.stream_iframe_url,
    thumbnailUrl: urls.stream_thumbnail_url,
  }
}

export async function deleteStreamVideo(uid: string): Promise<void> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_STREAM_TOKEN

  if (!accountId || !token) return

  const res = await fetch(`${CLOUDFLARE_API}/accounts/${accountId}/stream/${uid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok && res.status !== 404) {
    console.warn(`[stream] deleteStreamVideo uid=${uid} failed: ${res.status}`)
  }
}
