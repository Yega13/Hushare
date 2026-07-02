// Direct Rekognition via fetch + AWS Sig V4 using Web Crypto.
// No @aws-sdk/client-rekognition — it imports Node.js `fs` and crashes on Workers.
const enc = new TextEncoder()

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(data: string): Promise<string> {
  // TextEncoder.encode is the correct, portable path — no Buffer branch needed
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(data)))
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const keyBuf: ArrayBuffer = key instanceof Uint8Array
    ? key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer
    : key as ArrayBuffer
  const k = await crypto.subtle.importKey('raw', keyBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, enc.encode(data))
}

async function deriveSigningKey(secret: string, date: string, region: string): Promise<ArrayBuffer> {
  let key = await hmacSha256(enc.encode('AWS4' + secret), date)
  key = await hmacSha256(key, region)
  key = await hmacSha256(key, 'rekognition')
  return hmacSha256(key, 'aws4_request')
}

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  }
  const CHUNK = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function buildAmzDate(now: Date): { amzDate: string; dateStr: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const amzDate =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  return { amzDate, dateStr: amzDate.slice(0, 8) }
}

async function rekognitionPost(operation: string, body: unknown): Promise<unknown> {
  // .trim() defends against a trailing newline/space in the secret — a common cause of
  // InvalidSignatureException when the value was pasted or piped into `wrangler secret put`.
  const region = (process.env.AWS_REGION ?? 'eu-west-1').trim()
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim()
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('[rekognition] AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set')
  }

  const bodyStr = JSON.stringify(body)
  const host = `rekognition.${region}.amazonaws.com`
  const url = `https://${host}/`

  const { amzDate, dateStr } = buildAmzDate(new Date())
  const target = `RekognitionService.${operation}`

  const canonHeaders =
    `content-type:application/x-amz-json-1.1\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${target}\n`
  const signedHeaders = 'content-type;host;x-amz-date;x-amz-target'

  const canonRequest = [
    'POST', '/', '',
    canonHeaders,
    signedHeaders,
    await sha256Hex(bodyStr),
  ].join('\n')

  const credScope = `${dateStr}/${region}/rekognition/aws4_request`
  const strToSign = ['AWS4-HMAC-SHA256', amzDate, credScope, await sha256Hex(canonRequest)].join('\n')

  const sigKey = await deriveSigningKey(secretAccessKey, dateStr, region)
  const signature = toHex(await hmacSha256(sigKey, strToSign))

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Date': amzDate,
      'X-Amz-Target': target,
      Authorization: authorization,
    },
    body: bodyStr,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let name = 'RekognitionError'
    let message = `HTTP ${res.status}`
    try {
      const err = JSON.parse(text) as { __type?: string; message?: string; Message?: string }
      name = (err.__type ?? '').split('#').pop() ?? name
      message = err.message ?? err.Message ?? message
    } catch { /* non-JSON error body */ }
    throw Object.assign(new Error(message), { name })
  }

  return res.json() as Promise<unknown>
}

export function collectionId(albumId: string) {
  return `hushare-${albumId}`
}

export async function ensureCollection(albumId: string) {
  try {
    await rekognitionPost('CreateCollection', { CollectionId: collectionId(albumId) })
  } catch (err: unknown) {
    if ((err as { name?: string }).name !== 'ResourceAlreadyExistsException') throw err
  }
}

export async function indexPhotoFaces(albumId: string, photoId: string, imageUrl: string): Promise<string[]> {
  // SSRF guard — imageUrl must come from our own R2 CDN, never from arbitrary user-supplied URLs.
  // Strip any accidental scheme prefix from R2_PUBLIC_HOST so the comparison matches the URLs
  // produced by r2PublicUrl() (which always emits https://<bare-host>/key).
  const rawR2Host = process.env.R2_PUBLIC_HOST
  const r2Host = rawR2Host?.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  if (!r2Host || !imageUrl.startsWith(`https://${r2Host}/`)) {
    throw new Error('[rekognition] imageUrl must be from the configured R2 CDN host')
  }

  const imgRes = await fetch(imageUrl)
  if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.status}`)
  const base64Image = uint8ToBase64(new Uint8Array(await imgRes.arrayBuffer()))

  type IndexResult = { FaceRecords?: Array<{ Face?: { FaceId?: string } }> }
  const result = await rekognitionPost('IndexFaces', {
    CollectionId: collectionId(albumId),
    Image: { Bytes: base64Image },
    ExternalImageId: photoId,
    DetectionAttributes: [],
    MaxFaces: 15,
    QualityFilter: 'AUTO',
  }) as IndexResult

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return (result.FaceRecords ?? [])
    .map(r => r.Face?.FaceId)
    .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
}

export async function searchFacesByImage(
  albumId: string,
  selfieBytes: Uint8Array,
  threshold = 80,
): Promise<{ photoId: string; similarity: number }[]> {
  const safeThreshold = Math.max(0, Math.min(100, threshold))
  type SearchResult = {
    FaceMatches?: Array<{ Face?: { ExternalImageId?: string }; Similarity?: number }>
  }
  const result = await rekognitionPost('SearchFacesByImage', {
    CollectionId: collectionId(albumId),
    Image: { Bytes: uint8ToBase64(selfieBytes) },
    MaxFaces: 100,
    FaceMatchThreshold: safeThreshold,
  }) as SearchResult

  const seen = new Set<string>()
  const matches: { photoId: string; similarity: number }[] = []
  for (const match of result.FaceMatches ?? []) {
    const photoId = match.Face?.ExternalImageId
    const similarity = match.Similarity ?? 0
    if (photoId && !seen.has(photoId)) {
      seen.add(photoId)
      matches.push({ photoId, similarity })
    }
  }
  return matches.sort((a, b) => b.similarity - a.similarity)
}

export async function deleteFaces(albumId: string, faceIds: string[]) {
  if (!faceIds.length) return
  const CHUNK = 4000
  for (let i = 0; i < faceIds.length; i += CHUNK) {
    await rekognitionPost('DeleteFaces', {
      CollectionId: collectionId(albumId),
      FaceIds: faceIds.slice(i, i + CHUNK),
    })
  }
}

export async function deleteCollection(albumId: string) {
  try {
    await rekognitionPost('DeleteCollection', { CollectionId: collectionId(albumId) })
  } catch (err: unknown) {
    if ((err as { name?: string }).name !== 'ResourceNotFoundException') throw err
  }
}
