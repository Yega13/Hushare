import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { timingSafeEqual } from '@/lib/timing-safe'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { getUserTier } from '@/lib/subscriptions'
import { albumCountLimitForTier } from '@/lib/media'
import { decideClaim, type ClaimOutcome } from '@/lib/album-claim'
import { countAlbumsAgainstCap } from '@/lib/server/count-albums-against-cap'

// Allowlist of columns that callers may request beyond the base set.
// Never pass caller-supplied column names directly into .select() — SQL injection vector.
// password_hash is intentionally excluded: it is key material and must never leak
// via buggy API responses or logs.
// retired_at is intentionally excluded: owner mutations must not operate on retired albums;
// the retired_at filter is enforced at SQL level in every lookup below.
const ALLOWED_EXTRA_COLUMNS = new Set([
  'title', 'background_theme', 'cover_photo_id', 'header_image', 'logo_url', 'sponsor_logos', 'reveal_at',
  'media_radius', 'media_filter', 'mobile_grid_columns', 'desktop_grid_columns', 'photo_layout',
  'slideshow_interval_ms', 'slideshow_animation', 'slideshow_motion', 'video_autoplay',
  'guest_uploads_enabled', 'allow_guest_downloads', 'face_finder_enabled', 'bib_search_enabled', 'bib_min', 'bib_max',
  'last_activity_at', 'last_notification_at', 'created_at', 'branding_locked',
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
  /** What the auto-claim actually DID on this request. POST /api/album/claim reports this rather
   *  than re-deciding from a second read — see claimAlbumIfNeeded. */
  claim: ClaimOutcome
  /** The plan's album cap, when one was looked up; 0 when the question never arose. */
  claimCap: number
}

// SPLIT SO THE RATE-LIMITED CASE CANNOT BE BUILT WITHOUT ITS WAIT.
//
// This was one flat shape, and both 429 branches below threw `ipRl.retryAfterSeconds` away on the
// line after computing it. 28 route files consume these helpers, so that was the same defect the
// respond.ts work just fixed in eight routes, at three times the scale and on the owner path —
// /api/checkout/package ended up sending Retry-After on its own limiter's 429 and omitting it on
// the owner-access 429 two checks later. Same endpoint, two 429s, two different shapes.
//
// As a union, a rate_limited failure without the number is a compile error rather than an omission
// somebody has to notice.
type AccessFail =
  | {
    ok: false
    status: number
    error: string
    reason: 'missing' | 'not_found' | 'bad_token' | 'access_denied'
  }
  | {
    ok: false
    status: 429
    error: string
    reason: 'rate_limited'
    retryAfterSeconds: number
  }

// Both `slug` and `custom_slug` columns are constrained by schema.sql to this exact charset
// (`^[a-z0-9]{8}$` / `^[a-z0-9-]+$`). Validating the caller-supplied slug against it before use
// serves two purposes: (1) it lets a single `.or()` lookup safely stand in for the old two-step
// slug-then-custom_slug query, since the value is now guaranteed free of the `,().` characters
// PostgREST's filter syntax treats as special; (2) a value that fails this check cannot possibly
// match either column, so we skip the DB round trip entirely instead of querying and getting an
// empty result.
export const SLUG_CHARSET_RE = /^[a-z0-9-]+$/

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
  // `slug` is deliberately forced into the select above. It used to be absent, so this find read
  // an undefined property through an `as unknown as` cast, always missed, and silently fell through
  // to rows[0] — the exact ambiguity it exists to resolve. When one album's custom_slug matches
  // another album's random slug, picking the wrong row 403s every owner mutation on that album.
  // resolveAlbum has always selected slug and got this right; the two auth paths now agree.
  return rows.find((r) => (r as unknown as { slug?: string }).slug === cleanSlug) ?? rows[0]
}

// Claims an unclaimed album for the logged-in user on first owner access. Shared by both auth
// paths below, and by POST /api/album/claim, which reports the `outcome` this returns rather than
// deciding a second time from a second read — two reads of the same fact WILL disagree (rule 13),
// and here the disagreement was one-directional: the route could report a claim that never
// happened, never the reverse.
async function claimAlbumIfNeeded<T extends AlbumOwnerBase>(
  album: T,
): Promise<{ album: T; userId: string | null; outcome: ClaimOutcome; cap: number }> {
  // Only trust getUser() (server-validated JWT) — never fall back to getSession() (local cookie, unverified)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const viewerId = user?.id ?? null

  // Every rule about who may claim lives in decideClaim, shared with POST /api/album/claim so the
  // automatic path and the button cannot disagree. The cheap rules run first; the COUNT below only
  // happens when nothing cheaper settled it.
  let outcome = decideClaim({ albumUserId: album.user_id, viewerId, ownedCount: null, cap: 0 })
  let cap = 0

  if (outcome === 'needs_count' && user) {
    const admin = createAdminClient()

    // The plan's album cap applies HERE too, not only in api/album/create.
    //
    // Creating while signed out and signing in afterwards is a completely normal path, and it was
    // also a way around the cap: album/create checks the limit only for requests that arrive
    // authenticated, so albums made anonymously and then claimed were never counted against
    // anything. Enough of them and a free account holds any number of albums.
    const tier = await getUserTier(user)
    cap = albumCountLimitForTier(tier)
    // Shared with album/create — packaged albums are excluded, see the helper for why.
    const { count, error: countErr } = await countAlbumsAgainstCap(admin, user.id)

    if (countErr) {
      // A count we could not take is not a count of zero. Treating it as zero waves the album
      // through the cap; treating it as "cannot decide" leaves the album anonymous, which costs
      // the person nothing they can see and never over-grants (rule 19).
      console.error('[album-owner-access] album count failed, not claiming:', countErr.message)
      return { album, userId: viewerId, outcome: 'not_counted', cap }
    }

    outcome = decideClaim({ albumUserId: album.user_id, viewerId, ownedCount: count ?? 0, cap })

    if (outcome === 'claim') {
      // `.is('user_id', null)` is the race guard, and its WHOLE POINT is that it can match zero
      // rows. Without reading the result back, a request that lost the race still stamped user_id
      // into the in-memory album and logged "claimed" — so a second link-holder was handed an
      // album object saying it was theirs. That is not cosmetic: branding/route.ts and
      // custom-url/route.ts gate paid features on album.user_id, so the loser's request would
      // evaluate the winner's album against the LOSER's plan.
      const { data: updated, error: updErr } = await admin
        .from('albums').update({ user_id: user.id })
        .eq('id', album.id).is('user_id', null)
        .select('id')

      if (updErr || !updated || updated.length === 0) {
        if (updErr) console.error('[album-owner-access] claim update failed:', updErr.message)
        else console.info(`[album-owner-access] lost the claim race on album ${album.id}`)
        // The album is NOT ours. Leave user_id exactly as we read it and say so.
        return { album, userId: viewerId, outcome: 'owned_by_other', cap }
      }

      album = { ...album, user_id: user.id }
      console.info(`[album-owner-access] claimed album ${album.id} for user ${user.id}`)
    } else if (outcome === 'at_cap') {
      // Left anonymous rather than refused — see decideClaim for why that costs the person least.
      console.info(
        `[album-owner-access] not claiming album ${album.id} for user ${user.id}: at the ${tier} cap of ${cap}`,
      )
    }
  }

  return { album, userId: viewerId, outcome, cap }
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
    'id', 'owner_token', 'user_id', 'slug', 'custom_slug',
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

  const { album, userId, outcome, cap } = await claimAlbumIfNeeded(found)
  return { ok: true, album, userId, claim: outcome, claimCap: cap }
}

export async function verifyOwnerWithRateLimit<T extends AlbumOwnerBase = AlbumOwnerBase>(
  req: Request,
  slug: string,
  token: string,
  extraColumns?: string,
): Promise<AccessOk<T> | AccessFail> {
  // ANNOTATED, not inferred, and that is the point rather than tidiness.
  //
  // Both of these wrappers had no declared return type, so AccessFail never constrained them: an
  // inferred union simply widens to whatever the body happens to return. Splitting AccessFail so a
  // rate_limited failure must carry retryAfterSeconds therefore enforced NOTHING here -- deleting
  // the field from the 429 below left tsc perfectly green, which is how it went missing in the
  // first place. The annotation is what turns the type into a gate.
  // Distinct key from verifyOwnerViaCookieWithRateLimit to avoid shared-bucket exhaustion.
  // failOpen:false — if rate-limit store is unavailable, deny rather than allow unlimited attempts.
  const ipRl = await checkRateLimit(clientIpKey(req, 'owner_token'), 60, 30, { failOpen: false })
  if (!ipRl.ok) {
    return { ok: false as const, status: 429 as const, error: 'Too many requests. Please slow down.', reason: 'rate_limited' as const, retryAfterSeconds: ipRl.retryAfterSeconds }
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
    'id', 'owner_token', 'user_id', 'slug', 'custom_slug',
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

  const { album, userId, outcome, cap } = await claimAlbumIfNeeded(found)
  return { ok: true, album, userId, claim: outcome, claimCap: cap }
}

// Cookie OR the signed-in account that owns the album — for the surfaces a RETURNING owner
// reaches without their owner link.
//
// The renewal email lands two years after the event, on whatever device the owner opens it with.
// The owner cookie from the original browser is long gone, and the #owner= token is not in the
// email (it must never be — an emailed management link is a management link in every forwarded
// copy). Requiring the cookie there meant the renewal's primary audience could not pay. An album
// with a package is GUARANTEED claimed (checkout requires an account and payment claims it), so
// the account itself is proof of ownership: user.id === album.user_id.
//
// The cookie path is tried first and still works — it is the stronger, older proof and covers the
// owner mid-session on the original device.
export async function verifyOwnerViaCookieOrAccount<T extends AlbumOwnerBase = AlbumOwnerBase>(
  req: Request,
  slug: string,
  userId: string | null,
  extraColumns?: string,
) {
  const viaCookie = await verifyOwnerViaCookieWithRateLimit<T>(req, slug, extraColumns)
  if (viaCookie.ok || !userId) return viaCookie
  // A rate-limited caller must cost nothing further — no lookup on the account path either.
  if (viaCookie.reason === 'rate_limited') return viaCookie

  // No cookie, but a session: the album row itself says whether this account owns it.
  const cleanSlug = slug.trim().toLowerCase()
  const cols = Array.from(new Set([
    'id', 'owner_token', 'user_id', 'slug', 'custom_slug',
    ...validateExtraColumns(extraColumns ?? ''),
  ])).join(', ')
  const found = await lookupOwnableAlbum<T>(cleanSlug, cols)
  if (!found) {
    return { ok: false as const, status: 404, error: 'Album not found', reason: 'not_found' as const }
  }
  if (found.user_id !== userId) {
    // Covers the unclaimed album too: user_id null never equals a session id (userId is non-empty
    // by the guard above). The cookie failure already carries the right status; being signed in as
    // somebody else is not a better claim than holding no proof at all.
    return viaCookie
  }
  return { ok: true as const, album: found, userId, claim: 'already_yours' as const, claimCap: 0 }
}

export async function verifyOwnerViaCookieWithRateLimit<T extends AlbumOwnerBase = AlbumOwnerBase>(
  req: Request,
  slug: string,
  extraColumns?: string,
): Promise<AccessOk<T> | AccessFail> {
  // ANNOTATED, not inferred, and that is the point rather than tidiness.
  //
  // Both of these wrappers had no declared return type, so AccessFail never constrained them: an
  // inferred union simply widens to whatever the body happens to return. Splitting AccessFail so a
  // rate_limited failure must carry retryAfterSeconds therefore enforced NOTHING here -- deleting
  // the field from the 429 below left tsc perfectly green, which is how it went missing in the
  // first place. The annotation is what turns the type into a gate.
  // failOpen:false — if rate-limit store is unavailable, deny rather than allow unlimited
  // mutations. An outage that opens the gate would allow unlimited settings changes.
  const ipRl = await checkRateLimit(clientIpKey(req, 'owner_settings'), 60, 30, { failOpen: false })
  if (!ipRl.ok) {
    return { ok: false as const, status: 429 as const, error: 'Too many requests. Please slow down.', reason: 'rate_limited' as const, retryAfterSeconds: ipRl.retryAfterSeconds }
  }
  return verifyOwnerViaCookie<T>(slug, extraColumns)
}

/**
 * The same ownable-album lookup, but WITHOUT the retired_at filter — for /api/album/restore only.
 *
 * An album in the bin has retired_at set, which every lookup above deliberately excludes so that no
 * owner mutation can touch a hidden album. Restore is the one exception, and it has to reuse THIS
 * function rather than writing its own query, for two reasons that are both security-critical:
 *
 *   * the charset check is what makes the `.or()` safe. `slug` and `custom_slug` are constrained to
 *     `^[a-z0-9-]+$`, and validating before interpolating is what keeps the comma, parenthesis and
 *     dot that PostgREST's filter syntax treats as special out of the filter string. A second copy
 *     of this query written without it is a filter-injection hole (rule 13);
 *   * at most two rows can match, because a random slug and someone else's custom_slug can collide.
 *     The random slug wins. A `.limit(1)` picks whichever the planner returns first, which is a
 *     coin toss over WHICH ALBUM gets restored.
 *
 * It proves nothing about ownership. The caller checks the owner token.
 */
export async function lookupAlbumIncludingBinned(
  slug: string,
): Promise<{ id: string; slug: string; owner_token: string; deleted_at: string | null } | null> {
  const clean = slug.trim()
  if (!SLUG_CHARSET_RE.test(clean)) return null
  const admin = createAdminClient()
  const { data: rows, error } = await admin
    .from('albums')
    .select('id, slug, owner_token, deleted_at')
    .or(`slug.eq.${clean},custom_slug.eq.${clean}`)
    .limit(2)
    .returns<{ id: string; slug: string; owner_token: string; deleted_at: string | null }[]>()
  if (error || !rows || rows.length === 0) return null
  return rows.find((r) => r.slug === clean) ?? rows[0]
}
