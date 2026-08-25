import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { getUserTier } from '@/lib/subscriptions'
import { albumCountLimitForTier, ANON_ALBUM_LIMIT, ANON_ALBUM_DAILY_IP_LIMIT } from '@/lib/media'
import { track } from '@/lib/analytics'

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

const ANON_ALBUM_COOKIE = 'hushare_anon_albums'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The anon per-device cap stores the album IDs created on this device (not a bare count), so it can
// SELF-HEAL: on each create we drop IDs whose albums no longer exist, freeing their slot. A legacy
// value was a plain count ("2"), which isn't a UUID and so prunes to nothing here — a one-time reset
// that unsticks any creator the old ever-growing counter had permanently wedged.
function parseAnonAlbumIds(raw: string | undefined): string[] {
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s)).slice(0, 50)
}

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
  if (typeof title !== 'string') {
    return NextResponse.json({ error: 'Title must be 1–120 characters' }, { status: 400, headers: NO_STORE })
  }
  // Stored value: strip only C0 control chars + DEL (never valid in a title), then trim.
  // Everything else — including emoji and their ZWJ sequences (family, professions, flags) — is
  // preserved as entered. React JSX auto-escapes at render, emails use escapeHtml(), JSON-LD stringifies.
  const cleanTitle = title.replace(/[\x00-\x1F\x7F]/g, '').trim()
  // Visibility check ONLY (does not change what we store): a title made purely of zero-width /
  // invisible formatting chars (ZWSP, ZWNJ, ZWJ, word-joiner, BOM) renders as an empty cell yet
  // survives String.trim() and the DB char_length(>=1) constraint — that is how a nameless album
  // got created. Strip them here just to test whether any visible glyph remains: a lone ZWJ is
  // rejected, but a ZWJ *inside* an emoji is not, because the emoji's own codepoints stay visible.
  const visibleTitle = cleanTitle.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '').trim()
  if (visibleTitle.length < 1 || cleanTitle.length > 120) {
    return NextResponse.json({ error: 'Title must be 1–120 characters' }, { status: 400, headers: NO_STORE })
  }

  // Guests can create albums — auth is optional
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()

  // Album-count cap. Registered users get a hard cap by tier (counting their live albums). Anon users
  // have no stable identity, so their cap is a soft per-device cookie that lists the album IDs they've
  // created; we prune deleted ones so the cap self-heals. The per-IP rate limit above is the real
  // abuse backstop — this is just a nudge to sign in.
  let anonLiveIds: string[] = []
  if (user) {
    const tier = await getUserTier(user)
    const cap = albumCountLimitForTier(tier)
    const { count } = await admin
      .from('albums').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).is('retired_at', null)
    if ((count ?? 0) >= cap) {
      return NextResponse.json(
        { error: `You've reached your plan's album limit.${tier === 'studio' ? '' : ' Upgrade your plan to create more albums.'}` },
        { status: 403, headers: NO_STORE },
      )
    }
  } else {
    const priorIds = parseAnonAlbumIds((await cookies()).get(ANON_ALBUM_COOKIE)?.value)
    if (priorIds.length > 0) {
      // Keep only albums that STILL exist as LIVE anonymous albums — deleted or retired ones free
      // their slot (mirrors the registered path, which also ignores retired albums).
      const { data: alive } = await admin.from('albums').select('id').in('id', priorIds).is('user_id', null).is('retired_at', null)
      anonLiveIds = (alive ?? []).map((r) => r.id as string)
    }
    // The cookie above is a nudge and can simply be withheld. This cannot: it is counted server
    // side, per IP, and it is what actually stands between the album table and a script.
    const anonRl = await checkRateLimit(
      clientIpKey(req, 'anon_album_day'), 86400, ANON_ALBUM_DAILY_IP_LIMIT, { failOpen: false },
    )
    if (!anonRl.ok) {
      return NextResponse.json(
        { error: "You've created a lot of albums from this connection today. Register on Hushare — it's free — to keep going." },
        { status: 429, headers: { 'Retry-After': String(anonRl.retryAfterSeconds), ...NO_STORE } },
      )
    }
    if (anonLiveIds.length >= ANON_ALBUM_LIMIT) {
      return NextResponse.json(
        { error: "You've reached your album limit. Register on Hushare — it's free — to create more." },
        { status: 403, headers: NO_STORE },
      )
    }
  }

  const ownerToken = generateOwnerToken()

  for (let attempt = 0; attempt < MAX_SLUG_RETRIES; attempt++) {
    const slug = generateSlug()
    const { data, error } = await admin
      .from('albums')
      .insert({ title: cleanTitle, slug, owner_token: ownerToken, user_id: user?.id ?? null })
      .select('id, slug')
      .single()

    if (!error) {
      track({ name: 'album_created', albumId: data.id, userId: user?.id })
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
      // Append this album's ID to the per-device anon list so the soft cap self-heals when it (or any
      // sibling) is later deleted. Registered users are capped by a live DB count instead.
      if (!user) {
        res.cookies.set(ANON_ALBUM_COOKIE, [...anonLiveIds, data.id].join(','), {
          httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
        })
      }
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
