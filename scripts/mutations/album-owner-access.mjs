// Mutation set for src/lib/album-owner-access.ts -- run with:
//   node scripts/mutations/run.mjs album-owner-access
//
// WHO IS ALLOWED TO CHANGE AN ALBUM. Two independent proofs reach this file -- a bearer token from
// the management link, and the owner cookie -- and a third path lets a returning owner through on
// their signed-in account alone. Every mutation below is either a stranger holding the controls of
// somebody's wedding album, or the real owner locked out of it.
export default {
  file: 'src/lib/album-owner-access.ts',
  test: 'tests/album-owner-access.test.ts',
  mutations: [
  // ── what reaches PostgREST ───────────────────────────────────────────────────────────────────
  { name: 'the slug is not sanitised, so filter syntax reaches the .or() unescaped',
    from: "  if (!SLUG_CHARSET_RE.test(cleanSlug)) return null\n", to: "" },
  { name: 'the slug charset admits the characters PostgREST filters are built from',
    from: "export const SLUG_CHARSET_RE = /^[a-z0-9-]+$/", to: "export const SLUG_CHARSET_RE = /^[^\\n]+$/" },
  { name: 'a pasted link with capitals or spaces no longer matches its own album',
    from: "  const cleanSlug = slug.trim().toLowerCase()\n  const cleanToken = ownerToken.trim()", to: "  const cleanSlug = slug\n  const cleanToken = ownerToken.trim()" },
  { name: 'the column allow-list is dropped, so a caller selects any column it names',
    from: "  return extras.split(',').map((c) => c.trim()).filter((c) => ALLOWED_EXTRA_COLUMNS.has(c))",
    to: "  return extras.split(',').map((c) => c.trim()).filter(Boolean)" },

  // ── which album the lookup returns ───────────────────────────────────────────────────────────
  { name: 'RETIRED ALBUMS BECOME MUTABLE: an album in the bin takes owner writes again',
    from: "    .is('retired_at', null)\n    .limit(2)", to: "    .limit(2)" },
  { name: 'only one row is fetched, so a slug collision cannot be resolved at all',
    from: "    .limit(2)\n    .returns<T[]>()", to: "    .limit(1)\n    .returns<T[]>()" },
  { name: 'the collision is resolved by row order, which 403s every owner mutation on that album',
    from: "  return rows.find((r) => (r as unknown as { slug?: string }).slug === cleanSlug) ?? rows[0]",
    to: "  return rows[0]" },
  // NOT MUTATED -- `if (error || !rows || rows.length === 0) return null` is equivalent through
  // its callers. supabase-js returns data null whenever error is set, and an empty array
  // reaches `rows.find(...) ?? rows[0]` as undefined, which every caller turns into the same
  // 404 by the guard mutated below. The line is worth keeping (it says no at the point the
  // question is asked) but no input distinguishes it from its absence.
  { name: 'a missing album reaches the token comparison instead of a 404',
    from: "  const found = await lookupOwnableAlbum<T>(cleanSlug, cols)\n  if (!found) {\n    return { ok: false, status: 404, error: 'Album not found', reason: 'not_found' }\n  }\n\n  if (!timingSafeEqual(cleanToken",
    to: "  const found = await lookupOwnableAlbum<T>(cleanSlug, cols) as T\n  if (!timingSafeEqual(cleanToken" },

  // ── the bearer token ─────────────────────────────────────────────────────────────────────────
  { name: 'ANY TOKEN OPENS ANY ALBUM',
    from: "  if (!timingSafeEqual(cleanToken, found.owner_token)) {\n    return { ok: false, status: 403, error: 'Forbidden', reason: 'bad_token' }\n  }\n", to: "" },
  { name: 'the token is compared by prefix, so a shared prefix is enough',
    from: "  if (!timingSafeEqual(cleanToken, found.owner_token)) {",
    to: "  if (!found.owner_token.startsWith(cleanToken)) {" },
  { name: 'an empty slug or token reaches the database instead of a 400',
    from: "  if (!cleanSlug || !cleanToken) {\n    return { ok: false, status: 400, error: 'Missing slug or owner_token', reason: 'missing' }\n  }\n", to: "" },
  { name: 'a missing token alone is no longer refused up front',
    from: "  if (!cleanSlug || !cleanToken) {", to: "  if (!cleanSlug) {" },

  // ── the owner cookie ─────────────────────────────────────────────────────────────────────────
  { name: 'an EMPTY cookie is compared, which is both a timing oracle and a way in on an empty token',
    from: "  if (!ownerCookie) {\n    return { ok: false, status: 403, error: 'Forbidden', reason: 'bad_token' }\n  }\n", to: "" },
  { name: 'the cookie is not compared to the album at all',
    from: "  if (!timingSafeEqual(ownerCookie, found.owner_token)) {\n    return { ok: false, status: 403, error: 'Forbidden', reason: 'bad_token' }\n  }\n", to: "" },
  { name: 'the cookie is read from a fixed name, so one album cookie opens every album',
    from: "  const ownerCookie = (cookieStore.get(`hushare_owner_${found.id}`)?.value ?? '').trim()",
    to: "  const ownerCookie = (cookieStore.get('hushare_owner')?.value ?? '').trim()" },

  // ── the account path, for a returning owner with no cookie ───────────────────────────────────
  { name: 'BEING SIGNED IN AS ANYBODY IS OWNERSHIP',
    from: "  if (found.user_id !== userId) {", to: "  if (false) {" },
  { name: 'an unclaimed album is owned by whoever is signed in (null == null never fires, so the guard inverts)',
    from: "  if (found.user_id !== userId) {", to: "  if (found.user_id === userId) {" },
  { name: 'a signed-out caller still takes the account path, where userId is null',
    from: "  if (viaCookie.ok || !userId) return viaCookie", to: "  if (viaCookie.ok) return viaCookie" },
  { name: 'a rate-limited caller still pays for the account lookup',
    from: "  if (viaCookie.reason === 'rate_limited') return viaCookie\n", to: "" },
  { name: 'the account path reports a fresh claim rather than the album it already owned',
    from: "  return { ok: true as const, album: found, userId, claim: 'already_yours' as const, claimCap: 0 }",
    to: "  return { ok: true as const, album: found, userId, claim: 'claimed' as const, claimCap: 0 }" },

  // ── the rate limiter in front of both ────────────────────────────────────────────────────────
  { name: 'the token path is not rate limited at all, so the token is brute-forceable',
    from: "  const ipRl = await checkRateLimit(clientIpKey(req, 'owner_token'), 60, 30, { failOpen: false })\n  if (!ipRl.ok) {\n    return { ok: false as const, status: 429 as const, error: 'Too many requests. Please slow down.', reason: 'rate_limited' as const, retryAfterSeconds: ipRl.retryAfterSeconds }\n  }\n",
    to: "" },
  { name: 'an outage of the limiter store OPENS the gate instead of closing it',
    from: "clientIpKey(req, 'owner_token'), 60, 30, { failOpen: false }", to: "clientIpKey(req, 'owner_token'), 60, 30, { failOpen: true }" },
  { name: 'both paths share one bucket, so ordinary owner traffic exhausts the token limiter',
    from: "clientIpKey(req, 'owner_settings')", to: "clientIpKey(req, 'owner_token')" },
  { name: 'the 429 loses the retry-after the caller needs',
    from: "    return { ok: false as const, status: 429 as const, error: 'Too many requests. Please slow down.', reason: 'rate_limited' as const, retryAfterSeconds: ipRl.retryAfterSeconds }\n  }\n  return verifyAlbumOwnerAccess<T>(slug, token, extraColumns)",
    to: "    return { ok: false as const, status: 429 as const, error: 'Too many requests. Please slow down.', reason: 'rate_limited' as const, retryAfterSeconds: undefined }\n  }\n  return verifyAlbumOwnerAccess<T>(slug, token, extraColumns)" },
  ],
}
