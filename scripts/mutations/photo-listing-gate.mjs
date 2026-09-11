// Mutation set for fetchAuthorizedPhotos in src/lib/server/album-access.ts -- run with:
//   node scripts/mutations/run.mjs photo-listing-gate
//
// WHO GETS TO SEE THE PHOTOS. Every album page, the live wall, the delta refresh and the bib search
// read through this one function, so it is the only thing between somebody who knows an album id
// and the photo URLs inside it. It also carries the moderation filter, which is the same class of
// secret: a photo awaiting approval, or one the owner took down, must not reach a guest.
//
// Every refusal here returns a KIND rather than throwing, and every leak returns rows that look
// exactly like the rows a permitted caller gets. Nothing about either is visible without asking.
export default {
  file: 'src/lib/server/album-access.ts',
  test: 'tests/photo-listing-gate.test.ts tests/gates-and-money.test.ts tests/contribution-gate.test.ts',
  mutations: [
  // ── the album this is even about ─────────────────────────────────────────────────────────────
  { name: 'a non-UUID album id reaches PostgREST instead of being refused',
    from: "  if (!UUID_RE.test(albumId)) return { kind: 'invalid' }\n", to: "" },
  { name: 'a RETIRED album is listed while it waits to be deleted',
    from: "  if (!album || album.retired_at) return { kind: 'notfound' }\n\n  const ownerCookie",
    to: "  if (!album) return { kind: 'notfound' }\n\n  const ownerCookie" },

  // ── the owner ────────────────────────────────────────────────────────────────────────────────
  { name: 'THE OWNER TOKEN IS NOT COMPARED, so any cookie value opens a locked album',
    from: "  const isOwner = ownerCookie.length > 0 && timingSafeEqual(ownerCookie, album.owner_token)",
    to: "  const isOwner = ownerCookie.length > 0" },
  { name: 'the owner token is compared by prefix, which is walkable one character at a time',
    from: "  const isOwner = ownerCookie.length > 0 && timingSafeEqual(ownerCookie, album.owner_token)",
    to: "  const isOwner = ownerCookie.length > 0 && album.owner_token.startsWith(ownerCookie)" },
  { name: 'an EMPTY cookie is compared, which opens an album whose token is empty',
    from: "  const isOwner = ownerCookie.length > 0 && timingSafeEqual(ownerCookie, album.owner_token)",
    to: "  const isOwner = timingSafeEqual(ownerCookie, album.owner_token)" },
  { name: 'the owner cookie is read under a fixed name, so one album cookie opens every album',
    from: "  const ownerCookie = (cookieStore.get(`hushare_owner_${albumId}`)?.value ?? '').trim()\n  const isOwner = ownerCookie.length > 0",
    to: "  const ownerCookie = (cookieStore.get('hushare_owner')?.value ?? '').trim()\n  const isOwner = ownerCookie.length > 0" },

  // ── the reveal date ──────────────────────────────────────────────────────────────────────────
  { name: 'a SEALED album lists its photos before its date',
    from: "    if (album.reveal_at && new Date(album.reveal_at) > new Date()) return { kind: 'reveal' }\n", to: "" },
  { name: 'the reveal comparison inverts, so a revealed album is sealed forever',
    from: "    if (album.reveal_at && new Date(album.reveal_at) > new Date()) return { kind: 'reveal' }",
    to: "    if (album.reveal_at && new Date(album.reveal_at) < new Date()) return { kind: 'reveal' }" },

  // ── the password ─────────────────────────────────────────────────────────────────────────────
  { name: 'THE PASSWORD IS NOT CHECKED, so knowing the album id is enough again',
    from: "    if (album.password_hash) {\n      const pwCookie = cookieStore.get(`hushare_pw_${albumId}`)?.value ?? ''\n      authorized = pwCookie.length > 0",
    to: "    if (false) {\n      const pwCookie = cookieStore.get(`hushare_pw_${albumId}`)?.value ?? ''\n      authorized = pwCookie.length > 0" },
  { name: 'holding ANY password cookie counts as unlocked',
    from: "      authorized = pwCookie.length > 0\n        ? await verifyAccessToken(pwCookie, album.password_hash, albumId)\n        : false",
    to: "      authorized = pwCookie.length > 0" },
  { name: "another album's password cookie unlocks this one",
    from: "      authorized = pwCookie.length > 0\n        ? await verifyAccessToken(pwCookie, album.password_hash, albumId)",
    to: "      authorized = pwCookie.length > 0\n        ? await verifyAccessToken(pwCookie, album.password_hash, 'any-album')" },
  { name: 'the password cookie is read under a fixed name, so unlocking one album unlocks all',
    from: "      const pwCookie = cookieStore.get(`hushare_pw_${albumId}`)?.value ?? ''\n      authorized = pwCookie.length > 0",
    to: "      const pwCookie = cookieStore.get('hushare_pw')?.value ?? ''\n      authorized = pwCookie.length > 0" },
  { name: 'a failed unlock falls through to the listing instead of refusing',
    from: "      if (!authorized) return { kind: 'password' }\n", to: "" },

  // ── what a guest may see of what is there ────────────────────────────────────────────────────
  { name: 'A GUEST SEES EVERY HIDDEN PHOTO on the main listing -- moderation stops working',
    from: "  if (!isOwner) query = query.eq('hidden', false)", to: "  if (false) query = query.eq('hidden', false)" },
  { name: 'the moderation filter inverts, so a guest sees ONLY what the owner took down',
    from: "  if (!isOwner) query = query.eq('hidden', false)", to: "  if (isOwner) query = query.eq('hidden', false)" },
  { name: 'the DELTA read skips the filter, so every refresh leaks what the album page hides',
    from: "    const rows = await (isOwner ? query : query.eq('hidden', false))", to: "    const rows = await query" },
  { name: "the delta's own count ignores the filter, so the total contradicts the photos beside it",
    from: "    const { count } = await (isOwner ? countQ : countQ.eq('hidden', false))", to: "    const { count } = await countQ" },
  { name: 'the PROBE count ignores the filter -- the query a live album runs every few seconds',
    from: "      return isOwner ? q : q.eq('hidden', false)\n    }", to: "      return q\n    }" },
  { name: 'the probe\'s newest-photo lookup ignores the filter, so a hidden upload announces itself',
    from: "      return (isOwner ? q : q.eq('hidden', false))\n        .order('created_at', { ascending: false })",
    to: "      return q\n        .order('created_at', { ascending: false })" },

  // ── which album, and which columns the gate needs ────────────────────────────────────────────
  { name: 'the photo query is not scoped to this album',
    from: "  let query = admin.from('photos').select(PHOTO_SELECT_COLS).eq('album_id', albumId)",
    to: "  let query = admin.from('photos').select(PHOTO_SELECT_COLS)" },
  { name: 'the album lookup stops selecting the password hash, so every gated album reads as open',
    from: "    .select('id, user_id, owner_token, password_hash, reveal_at, retired_at, bib_search_enabled, bib_min, bib_max, bib_excluded_numbers, photo_order, package_tier, package_expires_at')",
    to: "    .select('id, user_id, owner_token, reveal_at, retired_at, bib_search_enabled, bib_min, bib_max, bib_excluded_numbers, photo_order, package_tier, package_expires_at')" },
  { name: "the album lookup stops selecting the race's bib bounds, so the caller's could be used instead",
    from: "    .select('id, user_id, owner_token, password_hash, reveal_at, retired_at, bib_search_enabled, bib_min, bib_max, bib_excluded_numbers, photo_order, package_tier, package_expires_at')",
    to: "    .select('id, user_id, owner_token, password_hash, reveal_at, retired_at, bib_search_enabled, photo_order, package_tier, package_expires_at')" },
  { name: 'the album lookup is not filtered by id, so the first album in the table answers',
    from: "    .eq('id', albumId)\n    .maybeSingle()", to: "    .maybeSingle()" },
  ],
}
