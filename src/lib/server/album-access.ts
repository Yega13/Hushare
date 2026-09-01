import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyAccessToken } from '@/lib/album-password'
import { timingSafeEqual } from '@/lib/timing-safe'
import { getUserTierById, getUserTierResolved } from '@/lib/subscriptions'
import { albumEffectiveTier } from '@/lib/album-entitlements'
import { uploadCapsForTier } from '@/lib/media'
import type { Album, Photo, SponsorLogo } from '@/types'

// Shared album access/gating logic — the SINGLE source of truth used by both the API routes
// (/api/album/resolve, /api/album/photos) and the server-rendered album page. Keeping the
// gating in one place guarantees the server render and the client-refetch path make identical
// owner/password/reveal decisions and can never drift out of sync.

// Minimal structural cookie type — accepts the result of `await cookies()` (next/headers)
// without coupling this module to that import, so it works from routes AND server components.
type CookieStore = { get(name: string): { value: string } | undefined }

const SLUG_RE = /^[a-z0-9-]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Mirrors the SELECT in the former resolve route. password_hash + retired_at are internal
// (stripped before returning); owner_token is fetched separately only when owner mode is asked.
const ALBUM_SELECT_COLS = [
  // user_id is fetched to size this album's upload caps by its OWNER's tier (see media_caps below).
  // It is stripped before the album is returned — it must never reach a client.
  'id', 'user_id', 'slug', 'custom_slug', 'title', 'background_theme',
  'media_radius', 'media_filter', 'mobile_grid_columns', 'desktop_grid_columns', 'photo_layout', 'photo_order',
  'slideshow_interval_ms', 'slideshow_animation', 'slideshow_motion', 'video_autoplay',
  'cover_photo_id', 'header_image', 'header_focal', 'header_zoom', 'header_touched', 'header_video_mode', 'reveal_at', 'guest_uploads_enabled', 'allow_guest_downloads',
  'require_approval', 'face_finder_enabled', 'bib_search_enabled', 'bib_min', 'bib_max', 'branding_locked',
  'package_tier', 'package_expires_at',
  'accent_color', 'logo_url', 'sponsor_logos', 'title_font', 'photo_style', 'welcome_message', 'hide_branding',
  'last_activity_at', 'created_at',
  'password_hash', 'retired_at',
].join(', ')

// Same columns AlbumPageClient renders (mirrors the former photos route).
import { bibSearchCandidates } from '@/lib/bib-match'
import { orderClausesFor, isPhotoOrder } from '@/lib/photo-order'

const PHOTO_SELECT_COLS = [
  'id', 'album_id', 'storage_path', 'storage_backend',
  'url', 'thumb_url', 'caption', 'author_name', 'created_at',
  'media_type', 'poster_url', 'stream_uid', 'stream_iframe_url',
  'stream_thumbnail_url', 'duration_seconds', 'width', 'height',
  'display_radius', 'display_filter', 'sort_order', 'face_ids', 'hidden', 'bib_numbers',
].join(', ')

type AlbumRow = {
  id: string; user_id: string | null; slug: string; custom_slug: string | null; title: string
  background_theme: string | null; media_radius: number; media_filter: string
  mobile_grid_columns: number; desktop_grid_columns: number | null; photo_layout: string; photo_order: string
  slideshow_interval_ms: number; slideshow_animation: string; slideshow_motion: unknown; video_autoplay: boolean
  cover_photo_id: string | null; header_image: string | null; header_focal: string | null; header_zoom: number | null; header_touched: boolean
  header_video_mode: string | null; reveal_at: string | null; guest_uploads_enabled: boolean
  allow_guest_downloads: boolean; require_approval: boolean; face_finder_enabled: boolean; bib_search_enabled: boolean
  bib_min: number | null; bib_max: number | null
  accent_color: string | null; logo_url: string | null; sponsor_logos: SponsorLogo[]
  title_font: string | null; photo_style: string | null; welcome_message: string | null; hide_branding: boolean
  branding_locked: boolean
  last_activity_at: string; created_at: string
  password_hash: string | null; retired_at: string | null
}

// Fire-and-forget activity touch, throttled to once/hour (retirement only needs coarse recency).
// Uses waitUntil so the write survives past a streamed response on Workers; falls back to a bare
// floating promise in dev / where the execution context isn't available.
function touchActivity(admin: ReturnType<typeof createAdminClient>, albumId: string, lastActivityAt: string): void {
  const ageMs = Date.now() - new Date(lastActivityAt).getTime()
  if (Number.isFinite(ageMs) && ageMs <= 60 * 60 * 1000) return
  const p = admin.from('albums')
    // last_notification_at is cleared alongside, or an album that comes back to life carries its
    // old warning forever. notify-expiry only ever warns an album whose last_notification_at is
    // NULL, and retire-albums now requires one that is at least 30 days old — so an album warned at
    // day 335, revived by its owner, and then quiet again for another year would be deleted on the
    // strength of a warning sent a year earlier, and could never be warned again. Clearing it here
    // means returning to an album genuinely resets the clock, which is what an owner would assume
    // "we email you 30 days before" means.
    .update({ last_activity_at: new Date().toISOString(), last_notification_at: null })
    .eq('id', albumId)
    .then(({ error }) => { if (error) console.error('[album-access] activity touch failed:', error.message) })
  try { getCloudflareContext().ctx.waitUntil(p as unknown as Promise<unknown>) } catch { void p }
}

// Fire-and-forget: for an album the owner has never explicitly set a header photo for (see
// header_touched), once it has at least one image, pick a decent-looking default — a landscape
// photo where possible — instead of leaving every untouched album on a bare accent band forever
// (most owners never open the Designer). Guarded by a conditional UPDATE so it can never clobber a
// header an owner set (or explicitly cleared) between the read above and this write, and never
// marks header_touched — a later manual "None" still permanently opts the album out.
function maybeAutoSuggestHeader(admin: ReturnType<typeof createAdminClient>, album: AlbumRow): void {
  if (album.header_touched || album.cover_photo_id || album.header_image) return
  const p = (async () => {
    const { data: candidates } = await admin
      .from('photos')
      .select('id, width, height')
      .eq('album_id', album.id)
      .eq('media_type', 'image')
      .order('created_at', { ascending: true })
      .limit(20)
      .returns<{ id: string; width: number | null; height: number | null }[]>()
    if (!candidates || candidates.length === 0) return
    const best = candidates.find((c) => c.width && c.height && c.width > c.height) ?? candidates[0]
    const { error } = await admin.from('albums')
      .update({ cover_photo_id: best.id })
      .eq('id', album.id)
      .eq('header_touched', false)
      .is('cover_photo_id', null)
      .is('header_image', null)
    if (error) console.error('[album-access] auto-suggest header failed:', error.message)
  })().catch((e: unknown) => console.error('[album-access] auto-suggest header failed:', e instanceof Error ? e.message : String(e)))
  try { getCloudflareContext().ctx.waitUntil(p) } catch { void p }
}

export type ResolveResult =
  | { kind: 'invalid' }
  | { kind: 'notfound' }
  | { kind: 'reveal'; reveal_at: string; slug: string; title: string }
  | { kind: 'password'; slug: string; title: string }
  | { kind: 'album'; album: Album }

// Resolve a slug (random or custom) to an album, applying the reveal/password gates.
//
// A valid owner cookie bypasses the gates, whether or not the caller asked for owner mode — see the
// note at the ownership check below for why those are separate questions. wantsOwner=true (the
// client, which CAN read the #owner= fragment) additionally forces the ownership lookup on an
// ungated album, where it would otherwise be wasted work.
//
// Gated albums still never leak photos into HTML for anyone who is not the owner: without a cookie
// that matches owner_token, the gate is rendered server-side exactly as before.
export async function resolveAlbum(
  slugRaw: string,
  wantsOwner: boolean,
  cookieStore: CookieStore,
): Promise<ResolveResult> {
  const slug = (slugRaw ?? '').trim().toLowerCase()
  if (!slug || slug.length < 4 || slug.length > 80 || !SLUG_RE.test(slug)) {
    return { kind: 'invalid' }
  }

  const admin = createAdminClient()
  const { data: rows } = await admin.from('albums').select(ALBUM_SELECT_COLS)
    .or(`slug.eq.${slug},custom_slug.eq.${slug}`)
    .is('retired_at', null)
    .limit(2)
    .returns<AlbumRow[]>()
  const album: AlbumRow | null = rows && rows.length > 0
    ? (rows.find((r) => r.slug === slug) ?? rows[0])
    : null
  if (!album || album.retired_at) return { kind: 'notfound' }

  const albumId = album.id

  // "Is this the owner?" and "is this an owner-MODE url?" are two different questions, and answering
  // the first with the second is what made an owner watch "this album is protected" on their own
  // album for a second before it opened.
  //
  // The #owner= token lives in the URL fragment, which no server ever receives — but the owner
  // COOKIE is httpOnly with path '/', so the browser sends it on the page request itself. The server
  // therefore already knows this visitor owns the album; it simply was not asking, because the check
  // was gated behind wantsOwner and the server render hardcodes that to false. fetchAuthorizedPhotos
  // in this same file has always trusted the cookie on its own, so the two halves of one access
  // decision disagreed: the resolve said "password gate", the photo read said "here are the photos".
  //
  // Owner chrome (the toolbar) still keys off the fragment, client-side, exactly as before. Only the
  // GATE bypass moves to the cookie — which is the credential that actually proves ownership, is
  // compared timing-safely against owner_token, and is scoped to this one album.
  const gated = !!album.password_hash || (!!album.reveal_at && new Date(album.reveal_at) > new Date())
  let isOwner = false
  const ownerCookieVal = (cookieStore.get(`hushare_owner_${albumId}`)?.value ?? '').trim()
  // Only pay for the lookup when the answer can change what gets rendered: an owner-mode request, or
  // a gate that ownership would lift. On an open album in guest view it changes nothing, so the
  // common path costs exactly what it did before.
  if (ownerCookieVal && (wantsOwner || gated)) {
    const { data: ownerRow } = await admin
      .from('albums').select('owner_token').eq('id', albumId)
      .maybeSingle<{ owner_token: string }>()
    isOwner = !!ownerRow && timingSafeEqual(ownerCookieVal, ownerRow.owner_token)
  }

  if (!isOwner) {
    if (album.reveal_at && new Date(album.reveal_at) > new Date()) {
      return { kind: 'reveal', reveal_at: album.reveal_at, slug: album.slug, title: album.title }
    }
    if (album.password_hash) {
      const pwCookie = cookieStore.get(`hushare_pw_${albumId}`)?.value ?? ''
      const unlocked = pwCookie.length > 0
        ? await verifyAccessToken(pwCookie, album.password_hash, albumId)
        : false
      if (!unlocked) return { kind: 'password', slug: album.slug, title: album.title }
    }
  }

  touchActivity(admin, albumId, album.last_activity_at)
  maybeAutoSuggestHeader(admin, album)

  // Sized by the OWNER's tier, exactly as /api/upload/presign sizes it (getUserTierById on the same
  // album.user_id), so the uploader and the authorizer cannot disagree about what this album allows.
  // One indexed subscriptions lookup per album load — negligible next to the presign path, which
  // runs this same call once per FILE.
  const ownerTier = await getUserTierById(album.user_id)
  // THE ALBUM'S tier, which since the packages is not always its OWNER's: a one-off package can
  // entitle the album above the account. Every mask and cap below keys on this — using ownerTier
  // for any of them would re-split the fact require-tier just unified, and its symptom is precise:
  // a paid Max Package album whose guests see no Face Finder button while the search itself works.
  const effectiveTier = albumEffectiveTier(ownerTier, {
    tier: (album as { package_tier?: 'pro' | 'studio' | null }).package_tier ?? null,
    expiresAt: (album as { package_expires_at?: string | null }).package_expires_at ?? null,
  })

  const { password_hash: _pw, retired_at: _ra, header_touched: _ht, user_id: _uid, ...publicAlbum } = album
  void _ra; void _ht; void _uid
  return {
    kind: 'album',
    album: {
      ...publicAlbum,
      password_protected: !!_pw,
      // The ALBUM'S plan, not the viewer's.
      //
      // The owner toolbar used to ask /api/me/tier — the plan of whoever is looking. Owner links are
      // shareable, so that is a different question, and after the gates were corrected to check
      // album.user_id the two could disagree outright: an admin opening a free owner's album saw no
      // PRO marks at all while the server refused every one of those features. It also meant the
      // owner of a free album could never see the marks if they happened to be signed in elsewhere.
      // Reveals nothing new — media_caps already states the tier exactly.
      plan: effectiveTier,
      // RE-CHECKED HERE, not just when it was switched on.
      //
      // hide_branding was gated only at write time, and nothing ever looked at it again: subscribe
      // for one month at the intro price, remove the mark from every album, cancel, and it stayed
      // gone forever. The FAQ tells customers paid extras are removed when a plan lapses, so this
      // was also a promise the code did not keep. Face Finder and Collections already re-check the
      // owner's tier on every request; this now does the same, and it is free — ownerTier is
      // already in hand for the upload caps.
      // Two ways to lose the mark, and both are refused here rather than only where they are set.
      // The plan check is the lapsed-subscription case; branding_locked is a collaboration album,
      // which was given Max for free in exchange for carrying our name. A stored `true` from before
      // either rule applied must not go on taking effect — that is exactly how hide_branding
      // survived a cancelled subscription forever the first time.
      hide_branding: album.hide_branding && effectiveTier !== 'free' && !album.branding_locked,
      // SAME RE-CHECK, for the two flags that put a control in front of GUESTS.
      //
      // Both of these open a search that api/album/face-search and api/album/bib-search refuse
      // unless the owner is on Max. Left unmasked, an album whose owner set them up while they were
      // free — or who has since downgraded — shows its visitors a button that always fails, which
      // reads as a broken album rather than as a plan boundary. The owner's own toolbar reads its
      // state from `plan` and the PRO/MAX marks, so it still shows the setting truthfully.
      //
      // require_approval and reveal_at are deliberately NOT masked here: unmasking those would
      // PUBLISH something the owner is holding back — photos awaiting approval, or an album that
      // has not opened yet. A plan boundary must never be the thing that reveals someone's photos.
      face_finder_enabled: album.face_finder_enabled && effectiveTier === 'studio',
      bib_search_enabled: album.bib_search_enabled && effectiveTier === 'studio',
      media_caps: uploadCapsForTier(effectiveTier),
    } as unknown as Album,
  }
}

// The gate applied to CONTRIBUTING to an album, as opposed to reading it.
//
// Viewing a password-protected album requires the password; uploading to it did not. The only
// thing an upload proved was knowledge of the album's internal id — which is visible to anyone who
// has ever loaded the page — so the id, not the password, was the real upload credential. Anyone
// who obtained it, including someone whose access was deliberately revoked by changing the
// password, could keep adding photos to a "protected" album indefinitely. A reveal date is the
// same argument: an album that has not opened yet should not be accepting contributions either.
//
// This lives beside fetchAuthorizedPhotos on purpose. The read gate and the write gate must make
// the same decision, and the surest way to guarantee that is for them to share a file and a shape.
export type AlbumGateRow = {
  id: string
  owner_token: string
  password_hash: string | null
  reveal_at: string | null
  /** The account that owns this album, when it has one. See the signed-in branch below. */
  user_id?: string | null
}

// Columns a caller must select for gateAllowsContribution to work. Keeps the two in step.
export const ALBUM_GATE_COLS = 'owner_token, password_hash, reveal_at'

// What a face-search result needs to render a tile and open the lightbox on it. Deliberately the
// full photo shape rather than a trimmed one: the results grid hands these straight to the same
// components the album grid uses, and a missing column there shows up as a blank tile.
export const FACE_MATCH_PHOTO_COLS = PHOTO_SELECT_COLS

// The `reason` is not decoration. A real customer had 163 uploads refused with "Enter the album
// password before adding photos" after four had gone through minutes earlier, on the same device,
// and it was impossible to say WHY: the message is identical whether the owner cookie was never
// sent, was sent and did not match, or the password token was missing or stale. Three different
// faults, one sentence. It is the same lesson the ZIP download taught with `catch { failed++ }`.
export type ContributionRefusal =
  | 'not-revealed'
  | 'owner-cookie-absent'      // no owner cookie at all — a guest, or one that was never set
  | 'owner-cookie-mismatch'    // an owner cookie that is not this album's token — stale or wrong album
  | 'password-cookie-absent'
  | 'password-cookie-stale'    // present but no longer verifies — password changed since unlocking

export async function gateAllowsContribution(
  album: AlbumGateRow,
  cookieStore: CookieStore,
  /**
   * The signed-in account, when the caller knows it.
   *
   * THE ACCOUNT IS STRONGER PROOF THAN THE COOKIE, and until now it was not accepted at all. A
   * paying customer created an album, uploaded four photos while it was still open — anyone may add
   * to an open album, so no ownership was ever demanded — then set a password from another tab. The
   * next 163 uploads were refused: the owner cookie had never been set in the tab she was uploading
   * from, and the gate had no other way to recognise her. She was signed in, on her own album, the
   * whole time.
   *
   * The owner cookie proves possession of a link that is meant to be shareable. A session proves
   * who someone is. Refusing the owner of an album because a cookie is missing from one tab is the
   * gate asking the weaker question.
   */
  signedInUserId?: string | null,
): Promise<{ ok: true } | { ok: false; error: string; reason: ContributionRefusal }> {
  const ownerCookie = (cookieStore.get(`hushare_owner_${album.id}`)?.value ?? '').trim()
  const ownerPresent = ownerCookie.length > 0
  if (ownerPresent && timingSafeEqual(ownerCookie, album.owner_token)) return { ok: true }

  // Signed in AS the album's owner. Both sides must be real strings — a null album.user_id (a guest
  // album) must never match a null session.
  if (signedInUserId && album.user_id && signedInUserId === album.user_id) return { ok: true }

  if (album.reveal_at && new Date(album.reveal_at) > new Date()) {
    return { ok: false, error: 'This album has not been revealed yet', reason: 'not-revealed' }
  }
  if (album.password_hash) {
    const pwCookie = cookieStore.get(`hushare_pw_${album.id}`)?.value ?? ''
    const unlocked = pwCookie.length > 0
      ? await verifyAccessToken(pwCookie, album.password_hash, album.id)
      : false
    if (!unlocked) {
      return {
        ok: false,
        error: 'Enter the album password before adding photos',
        // Which of the two it is decides everything: absent means they never unlocked on this
        // device, stale means the password was changed underneath someone who had.
        reason: pwCookie.length > 0
          ? 'password-cookie-stale'
          : ownerPresent ? 'owner-cookie-mismatch' : 'password-cookie-absent',
      }
    }
  }
  return { ok: true }
}

export type PhotosResult =
  | { kind: 'invalid' }
  | { kind: 'notfound' }
  | { kind: 'reveal' }
  | { kind: 'password' }
  | { kind: 'ok'; photos: Photo[]; total?: number; latest?: string | null; bibStats?: { indexed: number; totalImages: number } }
  // COULD NOT ANSWER — not "the answer is nothing". Returned when the owner's tier could not be
  // determined, so the caller reports a failure the guest can retry instead of an empty result they
  // will read as final. See getUserTierResolved.
  | { kind: 'unavailable' }

// Authorized photo listing. Anon RLS only exposes OPEN albums, so password/reveal-gated albums
// (and an owner's own view of them) are read here via the admin client AFTER verifying the caller
// is the owner (owner cookie) or an unlocked guest (password access-token cookie).
// Default page size for the full album view. Small albums (≤ this) fetch everything in one shot.
//
// 500, DOWN FROM 2000. This is what the album page server-renders, so on a 5,000-photo race album
// it was 1.63 MB of HTML before a guest saw anything — measured against a real 5,000-row album on
// 2026-08-29, on the venue WiFi the whole finish area shares.
//
// 2000 was the right number while both searches ran over the photos the phone had loaded: a
// smaller window meant a runner past it was told they had no photos. Now the database answers the
// bib search and face-search returns its own rows, so the window only decides how much of the grid
// is painted before scrolling — and 500 is already more than anyone scrolls through.
export const ALBUM_PAGE_SIZE = 500

export async function fetchAuthorizedPhotos(
  albumId: string,
  cookieStore: CookieStore,
  opts: { recentLimit?: number; offset?: number; limit?: number; bib?: string; bibStats?: boolean; statsOnly?: boolean; probe?: boolean; since?: string } = {},
): Promise<PhotosResult> {
  if (!UUID_RE.test(albumId)) return { kind: 'invalid' }

  const admin = createAdminClient()
  const { data: album } = await admin
    .from('albums')
    // bib_min/bib_max come from the ALBUM, never from the caller. They decide which OCR readings
    // count, so accepting them from the request would let anyone widen the race's numbering and
    // pull back photos the owner's bounds were set to exclude.
    .select('id, user_id, owner_token, password_hash, reveal_at, retired_at, bib_search_enabled, bib_min, bib_max, photo_order')
    .eq('id', albumId)
    .maybeSingle<{ id: string; user_id: string | null; owner_token: string; password_hash: string | null; reveal_at: string | null; retired_at: string | null; bib_search_enabled: boolean; bib_min: number | null; bib_max: number | null; photo_order: string }>()

  if (!album || album.retired_at) return { kind: 'notfound' }

  const ownerCookie = (cookieStore.get(`hushare_owner_${albumId}`)?.value ?? '').trim()
  const isOwner = ownerCookie.length > 0 && timingSafeEqual(ownerCookie, album.owner_token)
  let authorized = isOwner

  if (!authorized) {
    if (album.reveal_at && new Date(album.reveal_at) > new Date()) return { kind: 'reveal' }
    if (album.password_hash) {
      const pwCookie = cookieStore.get(`hushare_pw_${albumId}`)?.value ?? ''
      authorized = pwCookie.length > 0
        ? await verifyAccessToken(pwCookie, album.password_hash, albumId)
        : false
      if (!authorized) return { kind: 'password' }
    } else {
      authorized = true
    }
  }

  // Moderation: the owner sees every photo (so they can review/approve); guests only see photos
  // that aren't hidden (pending approval, or hidden by the owner).
  const recent = opts.recentLimit && opts.recentLimit > 0 ? opts.recentLimit : null
  // Full-view paging window. Defaults (offset 0, limit ALBUM_PAGE_SIZE) reproduce the old
  // single-shot `.limit(2000)` exactly; callers only pass offset/limit for a big album's next page.
  const offset = Math.max(0, Math.floor(opts.offset ?? 0))
  const limit = Math.min(ALBUM_PAGE_SIZE, Math.max(1, Math.floor(opts.limit ?? ALBUM_PAGE_SIZE)))

  // BIB SEARCH RUNS HERE, NOT ON THE PHONE.
  //
  // Matching used to happen client-side over the photos already loaded, which is instant and was
  // right for a 200-photo wedding. On a 5,000-photo race it quietly became a lie: the album loads a
  // window at a time, so a runner whose photos sit outside it typed their number and was told there
  // were none. The alternative — shipping all 5,000 rows to every phone so the filter could see
  // them — is 3-4 MB of JSON each, over the one venue WiFi, times every runner in the finish area.
  //
  // So the database answers instead. One GIN-indexed array overlap returns the runner's photos and
  // nothing else, whatever is loaded, on any album size. The phone still filters what it has as you
  // type, for the instant feel; this is the authoritative answer that replaces it.
  // THE FEATURE GATE IS RE-CHECKED HERE, on the album and on the owner's plan, and BEFORE the
  // stats short-circuit below — which is where it sat first, letting a stats request walk straight
  // past the very check that had just been added.
  //
  // Bib search reached this route as a query parameter, and nothing on the way in asked whether the
  // album had the feature switched on or whether its owner was still on Max. The client only ever
  // sends it for an album showing the search bar, so nothing leaked that the caller could not
  // already fetch — but every sibling path re-checks flag AND tier on the server (bib-index before
  // it spends money on OCR, face-search before it answers), and a gate that exists only in the
  // client is not a gate. It is a convention.
  if (opts.bib !== undefined || opts.statsOnly) {
    if (!album.bib_search_enabled) return { kind: 'ok', photos: [], total: 0 }
    if (!album.user_id) return { kind: 'ok', photos: [], total: 0 }
    // RESOLVED, not merely fetched. getUserTierById degrades to 'free' when the subscriptions query
    // fails, and this gate refuses by returning ZERO PHOTOS — so a single blip would have told
    // every runner at a race "No photos with that number", stated as final with no retry offered.
    // An empty result is only honest when we actually know the album is not entitled.
    const resolved = await getUserTierResolved(album.user_id)
    if (!resolved.authoritative) return { kind: 'unavailable' }
    if (resolved.tier !== 'studio') return { kind: 'ok', photos: [], total: 0 }
  }

  // Stats with no search: the bar shows "still reading photos, 1,200 of 5,000" before anyone has
  // typed, and that needs two counts, not five thousand rows. Without this the search bar's own
  // progress note would refetch the entire album on every page load.
  if (opts.statsOnly) {
    return { kind: 'ok', photos: [], total: 0, bibStats: await countBibStats(albumId, isOwner) }
  }

  // THE CHEAP QUESTION. "How many photos, and when was the newest added?" — answered by two
  // index lookups and about forty bytes, instead of the ~228 KB the 500-row window costs.
  //
  // The client asks this before every refresh and pulls the window only when the answer moved.
  // Almost every refresh returns what the client already has, and at event scale those wasted
  // fetches are what exhausts the database plan's transfer allowance — which throttles every
  // album on the platform, not only the busy one. Runs AFTER the same gate and tier checks as
  // the real fetch, so it cannot leak a count a password is withholding.
  if (opts.probe) {
    const visible = () => {
      const q = admin.from('photos').select('id', { count: 'exact', head: true }).eq('album_id', albumId)
      return isOwner ? q : q.eq('hidden', false)
    }
    const newest = () => {
      const q = admin.from('photos').select('created_at').eq('album_id', albumId)
      return (isOwner ? q : q.eq('hidden', false))
        .order('created_at', { ascending: false }).limit(1).maybeSingle<{ created_at: string }>()
    }
    const [{ count }, { data: last }] = await Promise.all([visible(), newest()])
    return { kind: 'ok', photos: [], total: count ?? 0, latest: last?.created_at ?? null }
  }

  // ASKING FOR A BIB SEARCH AND ASKING FOR THE ALBUM ARE DIFFERENT REQUESTS.
  //
  // bibSearchCandidates returns null for "nothing to search for", which at the top level correctly
  // means no filter. Passed straight through here it meant something else: `bib=abc` produced null
  // and returned the WHOLE album as that runner's photos. The client only ever sends stripped
  // digits so it is not reachable today, but the distinction it destroys is the one every test in
  // tests/bib-match.ts exists to protect, and it sits one layer above them. If `bib` was asked for
  // at all, an unusable value matches nothing — it never matches everything.
  const bibCandidates = opts.bib !== undefined
    ? (bibSearchCandidates(opts.bib, { min: album.bib_min, max: album.bib_max }) ?? [])
    : null
  // An empty candidate list is NOT "no filter" — it is a number that cannot match anything, such as
  // one outside the race's numbering. Returning the whole album here would hand a runner every
  // photo in it, so the search short-circuits to nothing instead.
  if (bibCandidates !== null && bibCandidates.length === 0) {
    return { kind: 'ok', photos: [], total: 0, bibStats: opts.bibStats ? await countBibStats(albumId, isOwner) : undefined }
  }

  // DELTA READ. `since` asks only for rows newer than what the client already has, which during
  // an event is a handful instead of the whole 500-row window. Measured: the window is 424 KB on
  // the real event album, and at a thousand guests that was the entire monthly database transfer
  // allowance in one afternoon. Deliberately NOT combined with a bib search or the recent feed —
  // those answer different questions and a delta of a filtered set is not a delta of the album.
  let query = admin.from('photos').select(PHOTO_SELECT_COLS).eq('album_id', albumId)
  if (opts.since && opts.bib === undefined && !opts.recentLimit) {
    const rows = await (isOwner ? query : query.eq('hidden', false))
      .gt('created_at', opts.since)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(Math.min(opts.limit ?? 100, 200))
      .returns<Photo[]>()
    if (rows.error) return { kind: 'ok', photos: [], total: 0 }
    // The count comes back with it, so a client applying a delta still learns the true size and
    // can tell that its own arithmetic agreed with the database.
    const countQ = admin.from('photos').select('id', { count: 'exact', head: true }).eq('album_id', albumId)
    const { count } = await (isOwner ? countQ : countQ.eq('hidden', false))
    return { kind: 'ok', photos: rows.data ?? [], total: count ?? 0 }
  }
  if (!isOwner) query = query.eq('hidden', false)
  if (bibCandidates) query = query.overlaps('bib_numbers', bibCandidates)
  // recentLimit (the live wall): fetch only the newest N — the wall shows a bounded window, so
  // pulling the whole album on every refetch is pure waste on the always-on display device.
  query = recent
    ? query.order('created_at', { ascending: false }).limit(recent)
    // id is the deterministic tiebreaker: without it two photos sharing (sort_order, created_at)
    // could swap places between page fetches, so range() paging would skip/duplicate one. With it
    // the total order is stable, which is what makes offset paging correct.
    // Ordering comes from the ALBUM, not from a constant here. It was fixed oldest-first, which
      // made the first window — the slice every realtime refresh reloads — the 500 OLDEST photos,
      // so on a growing album a new upload sorted past it and no visitor ever saw it arrive.
      // lib/photo-order.ts owns the clauses and guarantees a unique tiebreak.
    : orderClausesFor(isPhotoOrder(album.photo_order) ? album.photo_order : 'oldest')
        .reduce(
          (q, c) => q.order(c.column, { ascending: c.ascending, nullsFirst: c.nullsFirst ?? false }),
          query,
        )
        .range(offset, offset + limit - 1)
  const { data: photos, error } = await query

  if (error) {
    console.error('[album-access] photos fetch failed:', error.message)
    throw new Error('photos_fetch_failed')
  }

  // Total drives the wall counter + the album's hasMore. Optimisation: if the full view returned
  // FEWER than a full page, we've reached the end — so total = offset + what we got, no count query
  // (the common small-album case). Only a full page (maybe more) or the wall needs a HEAD count.
  const got = photos?.length ?? 0
  let total: number
  if (!recent && got < limit) {
    total = offset + got
  } else {
    let countQuery = admin.from('photos').select('id', { count: 'exact', head: true }).eq('album_id', albumId)
    if (!isOwner) countQuery = countQuery.eq('hidden', false)
    // The count must carry the same filter as the rows it is counting. Without this a bib search
    // that filled a page would report the whole album's size as its match count.
    if (bibCandidates) countQuery = countQuery.overlaps('bib_numbers', bibCandidates)
    const { count } = await countQuery
    total = count ?? offset + got
  }

  return {
    kind: 'ok',
    photos: (photos ?? []) as unknown as Photo[],
    total,
    bibStats: opts.bibStats ? await countBibStats(albumId, isOwner) : undefined,
  }
}

// How far OCR has got, counted over the WHOLE album rather than the loaded window.
//
// The search bar tells a runner "still reading photos, 1,200 of 5,000" so they do not read an
// empty result as "I was not photographed". Both numbers used to be counted over the photos the
// phone happened to hold, so on a partly-loaded album they agreed with each other perfectly and
// the bar fell silent — at exactly the moment the warning was true.
//
// Videos are excluded from both: nothing reads a bib off a video, so counting them would leave the
// bar permanently stuck below 100%.
async function countBibStats(albumId: string, isOwner: boolean): Promise<{ indexed: number; totalImages: number }> {
  const admin = createAdminClient()
  const base = () => {
    let q = admin.from('photos').select('id', { count: 'exact', head: true })
      .eq('album_id', albumId).neq('media_type', 'video')
    if (!isOwner) q = q.eq('hidden', false)
    return q
  }
  const [{ count: totalImages }, { count: indexed }] = await Promise.all([
    base(),
    base().not('bib_numbers', 'is', null),
  ])
  return { indexed: indexed ?? 0, totalImages: totalImages ?? 0 }
}
