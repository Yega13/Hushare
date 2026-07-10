import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { timingSafeEqual } from '@/lib/timing-safe'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

// Allowlist of columns that callers may request beyond the base set.
// Never pass caller-supplied column names directly into .select() — SQL injection vector.
// password_hash is intentionally excluded: it is key material and must never leak
// via buggy API responses or logs.
// retired_at is intentionally excluded: owner mutations must not operate on retired albums;
// the retired_at filter is enforced at SQL level in every lookup below.
const ALLOWED_EXTRA_COLUMNS = new Set([
  'title', 'background_theme', 'cover_photo_id', 'reveal_at',
  'media_radius', 'media_filter', 'media_hover', 'mobile_grid_columns', 'photo_layout',
  'slideshow_interval_ms', 'slideshow_animation', 'video_autoplay',
  'guest_uploads_enabled', 'allow_guest_downloads', 'face_finder_enabled',
  'last_activity_at', 'last_notification_at', 'created_at',
])

function validateExtraColumns(extras: string): string[] {
  return extras.split(',').map((c) => c.trim()).filter((c) => ALLOWED_EXTRA_COLUMNS.has(c))
}

type AlbumOwnerBase = {
  id: string
  owner_token: string
  user_id: string | null
  custom_slug?: string | null
}

type AccessOk<T extends AlbumOwnerBase> = {
  ok: true
  album: T
  userId: string | null
}

type AccessFail = {
  ok: false
  status: number
  error: string
  reason: 'missing' | 'not_found' | 'bad_token' | 'access_denied' | 'rate_limited'
}

// Both `slug` and `custom_slug` columns are constrained by schema.sql to this exact charset
// (`^[a-z0-9]{8}$` / `^[a-z0-9-]+$`). Validating the caller-supplied slug against it before use
// serves two purposes: (1) it lets a single `.or()` lookup safely stand in for the old two-step
// slug-then-custom_slug query, since the value is now guaranteed free of the `,().` characters
// PostgREST's filter syntax treats as special; (2) a value that fails this check cannot possibly
// match either column, so we skip the DB round trip entirely instead of querying and getting an
// empty result.
const SLUG_CHARSET_RE = /^[a-z0-9-]+$/

// Shared slug/custom_slug lookup used by both verifyAlbumOwnerAccess (bearer token) and
// verifyOwnerViaCookie (owner cookie) — previously duplicated verbatim in each. Kept as one
// implementation so the two auth paths cannot drift out of sync on this security-critical logic.
// Random slug takes priority over custom_slug in case of string overlap (both columns are
// unique, so at most 2 rows can ever match — resolved here in JS since `.or()` can't express
// "prefer this match").
async function lookupOwnableAlbum<T extends AlbumOwnerBase>(cleanSlug: string, cols: string): Promise<T | null> {
  if (!SLUG_CHARSET_RE.test(cleanSlug)) return null
  const admin = createAdminClient()
  const { data: rows, error } = await admin
    .from('albums')
    .select(cols)
    .or(`slug.eq.${cleanSlug},custom_slug.eq.${cleanSlug}`)
    .is('retired_at', null)
    .limit(2)
    .returns<T[]>()
  if (error || !rows || rows.length === 0) return null
  return rows.find((r) => (r as unknown as { slug?: string }).slug === cleanSlug) ?? rows[0]
}

// Claims an unclaimed album for the logged-in user on first owner access. Shared by both auth
// paths below.
async function claimAlbumIfNeeded<T extends AlbumOwnerBase>(album: T): Promise<{ album: T; userId: string | null }> {
  // Only trust getUser() (server-validated JWT) — never fall back to getSession() (local cookie, unverified)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user && !album.user_id) {
    const admin = createAdminClient()
    await admin.from('albums').update({ user_id: user.id }).eq('id', album.id).is('user_id', null)
    album = { ...album, user_id: user.id }
    console.info(`[album-owner-access] claimed album ${album.id} for user ${user.id}`)
  }

  return { album, userId: user?.id ?? null }
}

export async function verifyAlbumOwnerAccess<T extends AlbumOwnerBase = AlbumOwnerBase>(
  slug: string,
  ownerToken: string,
  extraColumns = '',
): Promise<AccessOk<T> | AccessFail> {
  const cleanSlug = slug.trim().toLowerCase()
  const cleanToken = ownerToken.trim()
  if (!cleanSlug || !cleanToken) {
    return { ok: false, status: 400, error: 'Missing slug or owner_token', reason: 'missing' }
  }

  const cols = Array.from(new Set([
    'id', 'owner_token', 'user_id', 'custom_slug',
    ...validateExtraColumns(extraColumns),
  ])).join(', ')

  // .is('retired_at', null) filters retired albums at SQL level — retired albums are
  // inaccessible even to owners so mutations cannot be applied to deleted content.
  const found = await lookupOwnableAlbum<T>(cleanSlug, cols)
  if (!found) {
    return { ok: false, status: 404, error: 'Album not found', reason: 'not_found' }
  }

  if (!timingSafeEqual(cleanToken, found.owner_token)) {
    return { ok: false, status: 403, error: 'Forbidden', reason: 'bad_token' }
  }

  const { album, userId } = await claimAlbumIfNeeded(found)
  return { ok: true, album, userId }
}

export async function verifyOwnerWithRateLimit<T extends AlbumOwnerBase = AlbumOwnerBase>(
  req: Request,
  slug: string,
  token: string,
  extraColumns?: string,
) {
  // Distinct key from verifyOwnerViaCookieWithRateLimit to avoid shared-bucket exhaustion.
  // failOpen:false — if rate-limit store is unavailable, deny rather than allow unlimited attempts.
  const ipRl = await checkRateLimit(clientIpKey(req, 'owner_token'), 60, 30, { failOpen: false })
  if (!ipRl.ok) {
    return { ok: false as const, status: 429, error: 'Too many requests. Please slow down.', reason: 'rate_limited' as const }
  }
  return verifyAlbumOwnerAccess<T>(slug, token, extraColumns)
}

export async function verifyOwnerViaCookie<T extends AlbumOwnerBase = AlbumOwnerBase>(
  slug: string,
  extraColumns = '',
): Promise<AccessOk<T> | AccessFail> {
  const cleanSlug = slug.trim().toLowerCase()
  if (!cleanSlug) {
    return { ok: false, status: 400, error: 'Missing slug', reason: 'missing' }
  }

  const cols = Array.from(new Set([
    'id', 'owner_token', 'user_id', 'custom_slug',
    ...validateExtraColumns(extraColumns),
  ])).join(', ')

  // .is('retired_at', null) prevents owner mutations on retired (soft-deleted) albums.
  const found = await lookupOwnableAlbum<T>(cleanSlug, cols)
  if (!found) {
    return { ok: false, status: 404, error: 'Album not found', reason: 'not_found' }
  }

  const cookieStore = await cookies()
  const ownerCookie = (cookieStore.get(`hushare_owner_${found.id}`)?.value ?? '').trim()
  // Owner access is granted ONLY by the owner cookie, which is set when the owner opens the
  // management link (#owner=token) or right after creating the album. Account identity alone
  // does NOT grant owner access: the public album URL is a guest experience for everyone,
  // including the logged-in creator, until they use their management link.
  // Reject empty cookies before comparison to avoid a timing oracle on the empty string.
  if (!ownerCookie) {
    return { ok: false, status: 403, error: 'Forbidden', reason: 'bad_token' }
  }
  if (!timingSafeEqual(ownerCookie, found.owner_token)) {
    return { ok: false, status: 403, error: 'Forbidden', reason: 'bad_token' }
  }

  const { album, userId } = await claimAlbumIfNeeded(found)
  return { ok: true, album, userId }
}

export async function verifyOwnerViaCookieWithRateLimit<T extends AlbumOwnerBase = AlbumOwnerBase>(
  req: Request,
  slug: string,
  extraColumns?: string,
) {
  // failOpen:false — if rate-limit store is unavailable, deny rather than allow unlimited
  // mutations. An outage that opens the gate would allow unlimited settings changes.
  const ipRl = await checkRateLimit(clientIpKey(req, 'owner_settings'), 60, 30, { failOpen: false })
  if (!ipRl.ok) {
    return { ok: false as const, status: 429, error: 'Too many requests. Please slow down.', reason: 'rate_limited' as const }
  }
  return verifyOwnerViaCookie<T>(slug, extraColumns)
}
