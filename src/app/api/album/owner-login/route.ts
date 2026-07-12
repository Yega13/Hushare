import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAlbumOwnerAccess } from '@/lib/album-owner-access'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// 7 days
const OWNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 7

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  // Rate limit as an abuse/DoS guard — NOT a brute-force defense (the owner_token is a 256-bit
  // secret compared timing-safely, so guessing is infeasible regardless of this limit). The old
  // 10/300s was low enough that an owner legitimately opening several albums (each with a client
  // retry) could hit it and get silently dropped to guest view. 40/300s keeps it bounded while
  // leaving comfortable headroom for real multi-album owner sessions.
  const rl = await checkRateLimit(clientIpKey(req, 'owner_login'), 300, 40, { failOpen: false })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const body = await req.json().catch(() => null) as { slug?: unknown; owner_token?: unknown } | null
  const { slug, owner_token } = body ?? {}

  if (typeof slug !== 'string' || typeof owner_token !== 'string') {
    return NextResponse.json({ error: 'Missing slug or owner_token' }, { status: 400, headers: NO_STORE })
  }
  // Tokens are short strings (~32–64 chars). Reject oversized values before the DB query
  // to avoid unnecessary load from malformed or malicious requests.
  if (slug.length > 80) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400, headers: NO_STORE })
  }
  if (owner_token.length > 512) {
    return NextResponse.json({ error: 'Invalid owner_token' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyAlbumOwnerAccess(slug.trim(), owner_token.trim())
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  const cookieStore = await cookies()
  cookieStore.set(`hushare_owner_${access.album.id}`, access.album.owner_token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: OWNER_COOKIE_MAX_AGE,
  })

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
