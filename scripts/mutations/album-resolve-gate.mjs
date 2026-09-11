// Mutation set for resolveAlbum in src/lib/server/album-access.ts -- run with:
//   node scripts/mutations/run.mjs album-resolve-gate
//
// WHETHER THE ALBUM PAGE RENDERS AT ALL, and what it publishes once it does. The third of three
// copies of one gate in this file, so several `from` strings carry a line of context purely to say
// which copy they mean (ARCHITECTURE.md section 6).
//
// Two kinds of failure live here and they are not the same. A gate that opens shows a stranger
// somebody's wedding. A MASK that stops masking publishes a paid mark on an album that no longer
// pays for it -- which is how hide_branding survived a cancelled subscription forever the first
// time, and it is invisible from the inside: the page renders perfectly either way.
export default {
  file: 'src/lib/server/album-access.ts',
  test: 'tests/album-resolve-gate.test.ts tests/gate-direction.test.ts tests/gates-and-money.test.ts',
  mutations: [
  // MOVED to scripts/mutations/album-gate-verdict.mjs on 2026-09-11. The reveal and password
  // checks are no longer written out here -- all three callers ask albumGateVerdict, and that
  // set runs its mutations against all three callers' tests at once. What stays below is what
  // is genuinely this caller's: who it counts as the owner, and the shape it answers in.
  // ── which album ──────────────────────────────────────────────────────────────────────────────
  { name: 'a slug carrying PostgREST filter syntax reaches the .or() unescaped',
    from: "  if (!slug || slug.length < 4 || slug.length > 80 || !SLUG_RE.test(slug)) {", to: "  if (false) {" },
  { name: 'the slug charset is dropped, so only the length is checked',
    from: "  if (!slug || slug.length < 4 || slug.length > 80 || !SLUG_RE.test(slug)) {",
    to: "  if (!slug || slug.length < 4 || slug.length > 80) {" },
  { name: 'a pasted link with capitals or spaces no longer opens its own album',
    from: "  const slug = (slugRaw ?? '').trim().toLowerCase()", to: "  const slug = slugRaw ?? ''" },
  { name: 'RETIRED albums render while they wait to be deleted',
    from: "    .or(`slug.eq.${slug},custom_slug.eq.${slug}`)\n    .is('retired_at', null)",
    to: "    .or(`slug.eq.${slug},custom_slug.eq.${slug}`)" },
  { name: 'only one row is fetched, so a slug collision cannot be resolved',
    from: "    .is('retired_at', null)\n    .limit(2)", to: "    .is('retired_at', null)\n    .limit(1)" },
  { name: "a collision resolves by row order, so a stranger's album renders under this URL",
    from: "    ? (rows.find((r) => r.slug === slug) ?? rows[0])", to: "    ? rows[0]" },

  // ── the owner, on the server render ──────────────────────────────────────────────────────────
  { name: 'THE OWNER TOKEN IS NOT COMPARED, so any cookie lifts both gates',
    from: "    isOwner = !!ownerRow && timingSafeEqual(ownerCookieVal, ownerRow.owner_token)",
    to: "    isOwner = !!ownerRow" },
  { name: 'the owner token is compared by prefix, walkable one character at a time',
    from: "    isOwner = !!ownerRow && timingSafeEqual(ownerCookieVal, ownerRow.owner_token)",
    to: "    isOwner = !!ownerRow && ownerRow.owner_token.startsWith(ownerCookieVal)" },
  { name: 'the owner cookie is read under a fixed name, so one album cookie opens every album',
    from: "  const ownerCookieVal = (cookieStore.get(`hushare_owner_${albumId}`)?.value ?? '').trim()",
    to: "  const ownerCookieVal = (cookieStore.get('hushare_owner')?.value ?? '').trim()" },
  { name: 'a REVEAL-ONLY album stops being worth an ownership lookup, so its owner sees a countdown',
    from: "  const gated = !!album.password_hash || revealPending(album)", to: "  const gated = !!album.password_hash" },
  { name: 'every album is treated as gated, so an open album pays for a lookup that changes nothing',
    from: "  const gated = !!album.password_hash || revealPending(album)", to: "  const gated = true" },
  { name: 'the owner is never recognised, so an owner sees their own album ask for a password',
    from: "  if (ownerCookieVal && (wantsOwner || gated)) {", to: "  if (false) {" },
  { name: 'the ownership lookup runs on every page load, costing a round trip that changes nothing',
    from: "  if (ownerCookieVal && (wantsOwner || gated)) {", to: "  if (ownerCookieVal || true) {" },
  { name: 'the owner-token lookup is not filtered to this album',
    from: "      .from('albums').select('owner_token').eq('id', albumId)", to: "      .from('albums').select('owner_token')" },

  // ── the gate ─────────────────────────────────────────────────────────────────────────────────

  // ── what reaches the browser ─────────────────────────────────────────────────────────────────
  { name: 'THE PASSWORD HASH IS SERIALISED INTO THE PAGE for everyone who opens the URL',
    from: "  const { password_hash: _pw, retired_at: _ra, header_touched: _ht, user_id: _uid, ...publicAlbum } = album",
    to: "  const { retired_at: _ra, header_touched: _ht, user_id: _uid, ...publicAlbum } = album\n  const _pw = album.password_hash" },
  { name: 'the page is told there is no password, so it never offers to unlock',
    from: "      password_protected: !!_pw,", to: "      password_protected: false," },

  // ── the masks a lapsed plan depends on ───────────────────────────────────────────────────────
  { name: 'HIDE_BRANDING SURVIVES A CANCELLED SUBSCRIPTION FOREVER (the original leak)',
    from: "      hide_branding: album.hide_branding && effectiveTier !== 'free' && !album.branding_locked,",
    to: "      hide_branding: album.hide_branding," },
  { name: 'a collaboration album can hide the mark it was given Max to carry',
    from: "      hide_branding: album.hide_branding && effectiveTier !== 'free' && !album.branding_locked,",
    to: "      hide_branding: album.hide_branding && effectiveTier !== 'free'," },
  { name: 'Face Finder is shown to guests on an album whose search will refuse them',
    from: "      face_finder_enabled: album.face_finder_enabled && effectiveTier === 'studio',",
    to: "      face_finder_enabled: album.face_finder_enabled," },
  { name: 'bib search is shown on a Pro album, where the search itself is Max-only',
    from: "      bib_search_enabled: album.bib_search_enabled && effectiveTier === 'studio',",
    to: "      bib_search_enabled: album.bib_search_enabled && effectiveTier !== 'free'," },
  { name: 'the album LOGO is published on a free album',
    from: "      logo_url: (isOwner || markGrandfathered || effectiveTier !== 'free') ? album.logo_url : null,",
    to: "      logo_url: album.logo_url," },
  { name: 'the logo is withheld from the OWNER too, which reads as "Hushare deleted my logo"',
    from: "      logo_url: (isOwner || markGrandfathered || effectiveTier !== 'free') ? album.logo_url : null,",
    to: "      logo_url: (markGrandfathered || effectiveTier !== 'free') ? album.logo_url : null," },
  { name: 'a PROMO-ERA album has the marks it was invited to set taken back',
    from: "  const markGrandfathered = Date.parse(album.created_at) < GRANDFATHER_FREE_BEFORE",
    to: "  const markGrandfathered = false" },
  { name: 'SPONSOR MARKS are published below Max',
    from: "      sponsor_logos: (isOwner || markGrandfathered || effectiveTier === 'studio')",
    to: "      sponsor_logos: (isOwner || markGrandfathered || effectiveTier !== 'free')" },

  // ── which tier every mask keys on ────────────────────────────────────────────────────────────
  { name: "the masks key on the OWNER's account, so a paid Max PACKAGE album is masked as free",
    from: "  const effectiveTier = albumEffectiveTier(ownerTier, {\n    tier: asPackageTier(album.package_tier),\n    expiresAt: album.package_expires_at,\n  })",
    to: "  const effectiveTier = ownerTier" },
  { name: 'an EXPIRED package still unmasks everything',
    from: "  const effectiveTier = albumEffectiveTier(ownerTier, {\n    tier: asPackageTier(album.package_tier),\n    expiresAt: album.package_expires_at,\n  })",
    to: "  const effectiveTier = albumEffectiveTier(ownerTier, {\n    tier: asPackageTier(album.package_tier),\n    expiresAt: '2099-01-01T00:00:00.000Z',\n  })" },
  { name: 'COLLECTIONS become album-scoped, so a single-album package unlocks an account feature',
    from: "      collections_enabled: ownerTier === 'studio',", to: "      collections_enabled: effectiveTier === 'studio'," },
  { name: 'the upload caps are sized from the account rather than the album',
    from: "      media_caps: uploadCapsForTier(effectiveTier),", to: "      media_caps: uploadCapsForTier(ownerTier)," },
  ],
}
