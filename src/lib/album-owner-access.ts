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
  'media_radius', 'media_filter', 'media_hover', 'mobile_grid_columns',
  'slideshow_interval_ms', 'slideshow_animation', 'video_autoplay',
  'guest_uploads_enabled', 'allow_guest_downloads',
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

  const admin = createAdminClient()
  const cols = Array.from(new Set([
    'id', 'owner_token', 'user_id', 'custom_slug',
    ...validateExtraColumns(extraColumns),
  ])).join(', ')

  // Two-step lookup: random slug takes priority over custom_slug in case of collision.
  // .is('retired_at', null) filters retired albums at SQL level — retired albums are
  // inaccessible even to owners so mutations cannot be applied to deleted content.
  let album: T | null = null

  const { data: bySlug, error: slugError } = await admin
    .from('albums')
    .select(cols)
    .eq('slug', cleanSlug)
    .is('retired_at', null)
    .maybeSingle<T>()

  if (slugError) {
    return { ok: false, status: 404, error: 'Album not found', reason: 'not_found' }
  }

  if (bySlug) {
    album = bySlug
  } else {
    const { data: byCustom, error: customError } = await admin
      .from('albums')
      .select(cols)
      .eq('custom_slug', cleanSlug)
      .is('retired_at', null)
      .maybeSingle<T>()

    if (customError) {
      return { ok: false, status: 404, error: 'Album not found', reason: 'not_found' }
    }
    album = byCustom
  }

  if (!album) {
    return { ok: false, status: 404, error: 'Album not found', reason: 'not_found' }
  }

  if (!timingSafeEqual(cleanToken, album.owner_token)) {
    return { ok: false, status: 403, error: 'Forbidden', reason: 'bad_token' }
  }

  // Only trust getUser() (server-validated JWT) — never fall back to getSession() (local cookie, unverified)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user && !album.user_id) {
    await admin.from('albums').update({ user_id: user.id }).eq('id', album.id).is('user_id', null)
    album = { ...album, user_id: user.id }
    console.info(`[album-owner-access] claimed album ${album.id} for user ${user.id}`)
  }

  return { ok: true, album, userId: user?.id ?? null }
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

  const admin = createAdminClient()
  const cols = Array.from(new Set([
    'id', 'owner_token', 'user_id', 'custom_slug',
    ...validateExtraColumns(extraColumns),
  ])).join(', ')

  // Two-step lookup: random slug takes priority over custom_slug in case of collision.
  // .is('retired_at', null) prevents owner mutations on retired (soft-deleted) albums.
  let album: T | null = null

  const { data: bySlug, error: slugError } = await admin
    .from('albums')
    .select(cols)
    .eq('slug', cleanSlug)
    .is('retired_at', null)
    .maybeSingle<T>()

  if (slugError) {
    return { ok: false, status: 404, error: 'Album not found', reason: 'not_found' }
  }

  if (bySlug) {
    album = bySlug
  } else {
    const { data: byCustom, error: customError } = await admin
      .from('albums')
      .select(cols)
      .eq('custom_slug', cleanSlug)
      .is('retired_at', null)
      .maybeSingle<T>()

    if (customError) {
      return { ok: false, status: 404, error: 'Album not found', reason: 'not_found' }
    }
    album = byCustom
  }

  if (!album) {
    return { ok: false, status: 404, error: 'Album not found', reason: 'not_found' }
  }

  const cookieStore = await cookies()
  const ownerCookie = (cookieStore.get(`hushare_owner_${album.id}`)?.value ?? '').trim()
  // Owner access is granted ONLY by the owner cookie, which is set when the owner opens the
  // management link (#owner=token) or right after creating the album. Account identity alone
  // does NOT grant owner access: the public album URL is a guest experience for everyone,
  // including the logged-in creator, until they use their management link.
  // Reject empty cookies before comparison to avoid a timing oracle on the empty string.
  if (!ownerCookie) {
    return { ok: false, status: 403, error: 'Forbidden', reason: 'bad_token' }
  }
  if (!timingSafeEqual(ownerCookie, album.owner_token)) {
    return { ok: false, status: 403, error: 'Forbidden', reason: 'bad_token' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user && !album.user_id) {
    await admin.from('albums').update({ user_id: user.id }).eq('id', album.id).is('user_id', null)
    album = { ...album, user_id: user.id }
    console.info(`[album-owner-access] claimed album ${album.id} for user ${user.id}`)
  }

  return { ok: true, album, userId: user?.id ?? null }
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
