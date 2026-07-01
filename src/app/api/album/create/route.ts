import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const SLUG_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'
const SLUG_CHARS_LEN = SLUG_CHARS.length  // 36
const MAX_SLUG_RETRIES = 10
// Rejection-sampling threshold: discard bytes ≥ 252 (= floor(256/36)*36) so that
// each retained byte maps uniformly to one of 36 chars with no modulo bias.
const REJECT_THRESHOLD = Math.floor(256 / SLUG_CHARS_LEN) * SLUG_CHARS_LEN  // 252

function generateSlug(): string {
  const chars: string[] = []
  while (chars.length < 8) {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    for (const b of bytes) {
      if (b < REJECT_THRESHOLD && chars.length < 8)
        chars.push(SLUG_CHARS[b % SLUG_CHARS_LEN])
    }
  }
  return chars.join('')
}

function generateOwnerToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// 7 days — matches the PBKDF2 token bucket window
const OWNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 7

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const rl = await checkRateLimit(clientIpKey(req, 'album_create'), 3600, 30, { failOpen: false })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many albums created. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const body = await req.json().catch(() => null) as { title?: unknown } | null
  const title = body?.title
  if (typeof title !== 'string' || title.trim().length < 1 || title.trim().length > 120) {
    return NextResponse.json({ error: 'Title must be 1–120 characters' }, { status: 400, headers: NO_STORE })
  }
  // Store the title as entered — React JSX auto-escapes at render time,
  // email templates use escapeHtml(), and JSON-LD uses JSON.stringify().
  // Only strip control characters (null bytes, newlines, etc.) that have no valid use
  // in a title and would either cause Postgres to error or render as invisible characters.
  const cleanTitle = title.trim().replace(/[\x00-\x1F\x7F]/g, '')

  // Guests can create albums — auth is optional
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const ownerToken = generateOwnerToken()

  for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt++) {
    const slug = generateSlug()
    const { data, error } = await admin
      .from('albums')
      .insert({ title: cleanTitle, slug, owner_token: ownerToken, user_id: user?.id ?? null })
      .select('id, slug')
      .single()

    if (!error) {
      // Owner token is set as an HttpOnly cookie AND returned to the creator so the client can
      // redirect to the management link (/slug#owner=token). Returning it here is safe: the
      // caller is the owner (they just created the album) — the same way the account dashboard
      // exposes owner_token to the owner. Public album URLs are guest-only; owner access comes
      // only from the #owner= management link, so the redirect must carry the token.
      const res = NextResponse.json({ slug: data.slug, owner_token: ownerToken }, { headers: NO_STORE })
      res.cookies.set(`hushare_owner_${data.id}`, ownerToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: OWNER_COOKIE_MAX_AGE,
      })
      return res
    }

    // 23505 = unique_violation — slug collision, retry with a new slug
    if (error.code !== '23505') {
      console.error('[album/create] insert failed:', error.code)
      return NextResponse.json({ error: 'Could not create album' }, { status: 500, headers: NO_STORE })
    }
  }

  console.error('[album/create] exhausted slug retry attempts')
  return NextResponse.json({ error: 'Could not create album, please try again' }, { status: 500, headers: NO_STORE })
}
