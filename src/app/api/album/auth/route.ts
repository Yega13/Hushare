import { NextResponse } from 'next/server'
import { verifyOwnerViaCookie } from '@/lib/album-owner-access'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const rl = await checkRateLimit(clientIpKey(req, 'album_auth'), 60, 60, { failOpen: false })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const body = await req.json().catch(() => null) as { slug?: unknown } | null
  const slug = body?.slug

  if (typeof slug !== 'string' || !slug.trim()) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookie(slug.trim())
  if (!access.ok) {
    // Not an error — just means the caller is not the owner
    return NextResponse.json({ isOwner: false }, { headers: NO_STORE })
  }

  // ownerToken is intentionally NOT included — it lives in the HttpOnly cookie only.
  // This is the authoritative owner check for all paths: post-create redirect (cookie
  // set directly by album/create) and direct owner-link navigation (#owner= fragment).
  return NextResponse.json({ isOwner: true }, { headers: NO_STORE })
}
