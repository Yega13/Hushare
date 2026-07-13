import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import {
  verifyPassword,
  deriveAccessToken,
  cookieNameForAlbum,
  PASSWORD_COOKIE_MAX_AGE_SECONDS,
  hashPassword,
  PBKDF2_ITERATIONS,
  MAX_PASSWORD_LEN,
} from '@/lib/album-password'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

type AlbumForPwVerify = {
  id: string
  password_hash: string | null
  slug: string
  retired_at: string | null
}

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; password?: unknown } | null
  const { slug, password } = body ?? {}

  if (typeof slug !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'Missing slug or password' }, { status: 400, headers: NO_STORE })
  }
  // Cap length to match MAX_PASSWORD_LEN so the error is consistent with what
  // hashPassword/verifyPassword enforce. Allowing 1024 here while verifyPassword
  // rejects >128 would silently consume the album rate-limit quota for inputs
  // that can never succeed.
  if (password.length === 0 || password.length > MAX_PASSWORD_LEN) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 400, headers: NO_STORE })
  }

  // IP rate limit before DB lookup — cheap check first.
  // failOpen:false — we must NOT allow brute force on DB outage.
  // Bumped for shared-NAT events (a crowd all entering the CORRECT password from one venue-WiFi
  // IP would trip a tight per-IP cap). The per-album limit below is the real per-password
  // brute-force guard; owners should still set a non-trivial password.
  const ipRl = await checkRateLimit(clientIpKey(req, 'pw_verify_ip'), 300, 200, { failOpen: false })
  if (!ipRl.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(ipRl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const admin = createAdminClient()
  const cleanSlug = slug.trim().toLowerCase()

  if (!cleanSlug || cleanSlug.length < 4 || cleanSlug.length > 80 || !/^[a-z0-9-]+$/.test(cleanSlug)) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400, headers: NO_STORE })
  }

  // Random slug takes priority. Filter retired_at at SQL level — JS check below is
  // belt-and-suspenders so we never fetch or process a retired album's password_hash.
  let album: AlbumForPwVerify | null = null
  const { data: bySlug } = await admin.from('albums')
    .select('id, password_hash, slug, retired_at')
    .eq('slug', cleanSlug)
    .is('retired_at', null)
    .maybeSingle<AlbumForPwVerify>()
  if (bySlug) {
    album = bySlug
  } else {
    const { data: byCustom } = await admin.from('albums')
      .select('id, password_hash, slug, retired_at')
      .eq('custom_slug', cleanSlug)
      .is('retired_at', null)
      .maybeSingle<AlbumForPwVerify>()
    album = byCustom
  }

  if (!album || album.retired_at) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (!album.password_hash) {
    return NextResponse.json({ error: 'Album has no password' }, { status: 400, headers: NO_STORE })
  }

  // Album-level rate limit — limits brute force on a single album's password.
  // failOpen:false — same reasoning as IP limit above. 120/5min tolerates a real crowd unlocking
  // a password-protected event while still throttling automated guessing to a slow crawl.
  const albumRl = await checkRateLimit(`pw_verify_album:${album.id}`, 300, 120, { failOpen: false })
  if (!albumRl.ok) {
    return NextResponse.json(
      { error: 'Too many attempts on this album. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(albumRl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const valid = await verifyPassword(password, album.password_hash)
  if (!valid) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401, headers: NO_STORE })
  }

  // Upgrade legacy/weak hashes synchronously so the issued token uses the new hash.
  // Fire-and-forget would create a race: the new hash reaches the DB before the next
  // page visit, causing verifyAccessToken to compare the old-hash cookie against the
  // new DB hash → immediate session invalidation on first post-login request.
  const parts = album.password_hash.split('$')
  const isLegacy = parts[0] === 'hmac-sha256-v1'
  const isWeak = parts[0] === 'pbkdf2' && Number.parseInt(parts[1] ?? '0', 10) < PBKDF2_ITERATIONS
  let hashForToken = album.password_hash
  if (isLegacy || isWeak) {
    try {
      const newHash = await hashPassword(password)
      const { error: rehashErr } = await admin.from('albums').update({ password_hash: newHash }).eq('id', album.id)
      if (!rehashErr) {
        hashForToken = newHash
      } else {
        console.error('[pw/verify] rehash update failed:', rehashErr.message)
      }
    } catch (e) {
      console.error('[pw/verify] rehash failed:', e instanceof Error ? e.message : String(e))
    }
  }

  const token = await deriveAccessToken(hashForToken, album.id)
  const cookieStore = await cookies()
  cookieStore.set(cookieNameForAlbum(album.id), token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: PASSWORD_COOKIE_MAX_AGE_SECONDS,
  })

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
