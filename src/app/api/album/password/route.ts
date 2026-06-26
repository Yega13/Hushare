import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { hashPassword, MIN_PASSWORD_LEN, MAX_PASSWORD_LEN } from '@/lib/album-password'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; password?: unknown } | null
  const { slug, password } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  // Validate length before auth — cheap feedback, no PBKDF2 yet.
  if (typeof password === 'string' && password.length > 0) {
    if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
      return NextResponse.json(
        { error: `Password must be ${MIN_PASSWORD_LEN}–${MAX_PASSWORD_LEN} characters` },
        { status: 400, headers: NO_STORE },
      )
    }
  }

  // Auth BEFORE hashing — prevents unauthenticated callers from burning 600k PBKDF2
  // iterations per request up to the rate-limit window.
  const access = await verifyOwnerViaCookieWithRateLimit(req, slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  // Hash only after auth is confirmed — 600k PBKDF2 iterations on authenticated requests only.
  let passwordHash: string | null = null
  if (typeof password === 'string' && password.length > 0) {
    passwordHash = await hashPassword(password)
  }

  const admin = createAdminClient()
  const { error } = await admin.from('albums').update({ password_hash: passwordHash }).eq('id', access.album.id)
  if (error) {
    console.error('[album/password] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update password' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, hasPassword: passwordHash !== null }, { headers: NO_STORE })
}
