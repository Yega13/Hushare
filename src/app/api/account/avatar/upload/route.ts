import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { createPresignedPut, r2PublicUrl, isAllowedImage, safeExtForMime } from '@/lib/cloudflare/r2'
import { v4 as uuid } from 'uuid'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// A face, not a photograph. Big enough for anything a phone camera produces after the browser has
// resized it, small enough that nobody can quietly park a gallery in the avatar bucket.
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

// Presign a PUT for the signed-in account's own avatar.
//
// Mirrors api/album/logo/upload, with one important difference: there is no slug and no owner
// token, because the only thing that may write here is the account itself. The key is derived from
// the SESSION's user id and never from anything in the request body — a client-supplied path is how
// an avatar upload turns into a write primitive for someone else's folder.
export async function POST(req: Request) {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401, headers: NO_STORE })
  }

  const body = await req.json().catch(() => null) as {
    contentType?: unknown
    fileName?: unknown
    fileSize?: unknown
  } | null
  const { contentType, fileName, fileSize } = body ?? {}

  if (typeof contentType !== 'string' || !isAllowedImage(contentType.toLowerCase())) {
    return NextResponse.json({ error: 'Invalid or unsupported image type' }, { status: 415, headers: NO_STORE })
  }
  if (
    typeof fileSize !== 'number' || !Number.isFinite(fileSize) || !Number.isInteger(fileSize)
    || fileSize <= 0 || fileSize > MAX_AVATAR_BYTES
  ) {
    return NextResponse.json(
      { error: `Invalid file size (max ${MAX_AVATAR_BYTES / 1024 / 1024} MB)` },
      { status: 400, headers: NO_STORE },
    )
  }

  // Per account, not per IP: the thing worth bounding is one person cycling uploads, and an IP is
  // shared by everyone behind a venue's wifi. failOpen:false — deny during an outage rather than
  // hand out unbounded presigned slots.
  const rl = await checkRateLimit(`avatar_upload:${user.id}`, 600, 6, { failOpen: false })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many uploads. Try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds), ...NO_STORE } },
    )
  }
  // A second, coarser bound so one IP cannot cycle accounts to mint slots.
  const ipRl = await checkRateLimit(clientIpKey(req, 'avatar_upload_ip'), 3600, 40, { failOpen: false })
  if (!ipRl.ok) {
    return NextResponse.json({ error: 'Too many uploads. Try again later.' }, { status: 429, headers: NO_STORE })
  }

  const normalizedType = contentType.toLowerCase()
  const rawExt = typeof fileName === 'string' ? (fileName.split('.').pop()?.toLowerCase() ?? '') : ''
  const ext = safeExtForMime(normalizedType, rawExt)
  // The uuid makes the object name unguessable and makes replacing an avatar a new object rather
  // than an overwrite, so a cached old image can never be served in place of a new one.
  const key = `avatars/${user.id}/${uuid()}.${ext}`

  try {
    return NextResponse.json(
      { presignedUrl: await createPresignedPut(key, normalizedType, 3600, fileSize), publicUrl: r2PublicUrl(key) },
      { headers: NO_STORE },
    )
  } catch (e) {
    console.error('[account/avatar/upload] presign failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: 'Could not generate upload URL' }, { status: 502, headers: NO_STORE })
  }
}
