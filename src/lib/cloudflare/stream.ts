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
  maxDurationSeconds: number,
): Promise<StreamUploadInit> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_STREAM_TOKEN

  if (!accountId || !token) {
    throw new Error('Missing Cloudflare Stream credentials')
  }

  const safeName = sanitizeFileName(fileName)

  // maxDurationSeconds is REQUIRED for direct_user (creator) tus uploads. Without it the creation
  // still returns a URL, but the upload FAILS during processing (the "error after 100% using TUS"
  // symptom). CRITICAL: Cloudflare reserves maxDurationSeconds of STORAGE QUOTA per pending
  // upload, so the caller passes a TIGHT value (client-measured duration + margin) — a blanket 6h
  // reserved 360 min per incomplete upload and exhausted the account quota. Clamp defensively.
  const safeMaxDuration = Math.min(21600, Math.max(60, Math.round(maxDurationSeconds) || 7200))
  // expiry: how long this upload URL stays valid; also when an abandoned pending upload (and its
  // reserved quota) is reclaimed. 2h covers a slow, resumed large-video upload while freeing
  // quota from abandoned uploads reasonably quickly. Cloudflare requires 2 min–6h from now.
  const expiry = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  const uploadMetadata = [
    `name ${safeBase64(safeName)}`,
    `maxDurationSeconds ${safeBase64(String(safeMaxDuration))}`,
    `expiry ${safeBase64(expiry)}`,
  ].join(',')

  const res = await fetch(
    `${CLOUDFLARE_API}/accounts/${accountId}/stream?direct_user=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(fileSizeBytes),
        'Upload-Metadata': uploadMetadata,
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
  // that points somewhere other than Cloudflare Stream's TUS endpoints — the client
  // should never TUS-upload to an attacker-controlled endpoint. Cloudflare returns either
  // upload.videodelivery.net (legacy) or upload.cloudflarestream.com (current).
  if (
    !uploadUrl.startsWith('https://upload.videodelivery.net/') &&
    !uploadUrl.startsWith('https://upload.cloudflarestream.com/')
  ) {
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

// Minimal shape of a Stream list entry — only the fields the stale-upload sweep needs.
type StreamListVideo = {
  uid: string
  created: string
  uploadExpiry: string | null
  maxDurationSeconds: number | null
  status: { state: string } | null
}

// Every incomplete Stream upload RESERVES its maxDurationSeconds of storage quota until it either
// finishes or is reclaimed. createStreamUpload sets a 2h `expiry` expecting Cloudflare to reclaim
// abandoned uploads — but in production they've been observed lingering for many DAYS past expiry,
// silently piling up reserved quota until it exhausted the account's storage and the "capacity
// running low" warning fired (see the maxDurationSeconds note in createStreamUpload). This daily
// sweep deletes any non-ready upload whose uploadExpiry is already PAST, so quota can't be held
// hostage by uploads that can never complete. Because it only touches EXPIRED uploads, an upload a
// guest is actively working on right now (expiry still in the future) is never at risk.
export async function cleanupStaleStreamUploads(): Promise<{
  scanned: number
  deleted: number
  failed: number
  reclaimedMinutes: number
}> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_STREAM_TOKEN
  if (!accountId || !token) throw new Error('Missing Cloudflare Stream credentials')
  const headers = { Authorization: `Bearer ${token}` }
  const now = Date.now()

  // Page through the whole video list (descending by created; page via `end` = older-than cursor).
  const stale: { uid: string; maxDurationSeconds: number }[] = []
  let scanned = 0
  let end: string | undefined
  for (let page = 0; page < 50; page++) {
    const u = new URL(`${CLOUDFLARE_API}/accounts/${accountId}/stream`)
    u.searchParams.set('limit', '1000')
    if (end) u.searchParams.set('end', end)
    const res = await fetch(u, { headers })
    if (!res.ok) throw new Error(`Stream list failed: ${res.status}`)
    const json = (await res.json()) as { success: boolean; result: StreamListVideo[] }
    if (!json.success) throw new Error('Stream list returned success=false')
    const batch = json.result ?? []
    scanned += batch.length
    for (const v of batch) {
      if (v.status?.state === 'ready') continue
      // Non-ready (pendingupload/inprogress/queued/downloading/error): delete only once its upload
      // window has closed, so a currently-in-flight upload is never caught.
      if (v.uploadExpiry && new Date(v.uploadExpiry).getTime() < now) {
        stale.push({ uid: v.uid, maxDurationSeconds: v.maxDurationSeconds ?? 0 })
      }
    }
    if (batch.length < 1000) break
    const nextCursor = batch[batch.length - 1]?.created
    if (!nextCursor || nextCursor === end) break // no progress → stop (avoids a dup-timestamp loop)
    end = nextCursor
  }

  let deleted = 0
  let failed = 0
  let reclaimedSeconds = 0
  for (const s of stale) {
    const res = await fetch(`${CLOUDFLARE_API}/accounts/${accountId}/stream/${s.uid}`, {
      method: 'DELETE',
      headers,
    })
    if (res.ok || res.status === 404) {
      deleted++
      reclaimedSeconds += s.maxDurationSeconds
    } else {
      failed++
      console.warn(`[stream-cleanup] delete uid=${s.uid} failed: ${res.status}`)
    }
  }
  return { scanned, deleted, failed, reclaimedMinutes: Math.round(reclaimedSeconds / 60) }
}
