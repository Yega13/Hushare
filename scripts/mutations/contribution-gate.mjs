// Mutation set for the CONTRIBUTION GATE in src/lib/server/album-access.ts -- run with:
//   node scripts/mutations/run.mjs contribution-gate
//
// WHO MAY ADD TO A PRIVATE ALBUM. Three independent proofs are accepted -- the owner cookie, the
// signed-in account that owns the album, and the password cookie -- and every route that writes to
// an album asks this one function, so a hole here is a hole everywhere at once.
//
// Both directions have already cost something real. Too tight: a paying customer set a password
// from another tab and had her next 163 uploads refused on her own album, because the gate only
// knew about a cookie that tab had never been given. Too loose is a stranger uploading into a
// locked album, which is the thing the password was bought for.
export default {
  file: 'src/lib/server/album-access.ts',
  test: 'tests/gates-and-money.test.ts tests/gate-direction.test.ts tests/album-select-cols.test.ts tests/contribution-gate.test.ts',
  mutations: [
  // MOVED to scripts/mutations/album-gate-verdict.mjs on 2026-09-11. The reveal and password
  // checks are no longer written out here -- all three callers ask albumGateVerdict, and that
  // set runs its mutations against all three callers' tests at once. What stays below is what
  // is genuinely this caller's: who it counts as the owner, and the shape it answers in.
  // ── the owner cookie ─────────────────────────────────────────────────────────────────────────
  { name: 'THE OWNER COOKIE IS NOT COMPARED, so holding any value opens a locked album',
    from: "  if (ownerPresent && timingSafeEqual(ownerCookie, album.owner_token)) return { ok: true }",
    to: "  if (ownerPresent) return { ok: true }" },
  { name: 'the owner cookie is compared by prefix rather than in full',
    from: "  if (ownerPresent && timingSafeEqual(ownerCookie, album.owner_token)) return { ok: true }",
    to: "  if (ownerPresent && album.owner_token.startsWith(ownerCookie)) return { ok: true }" },
  { name: 'an EMPTY owner cookie is compared, which opens an album whose token is empty',
    from: "  if (ownerPresent && timingSafeEqual(ownerCookie, album.owner_token)) return { ok: true }",
    to: "  if (timingSafeEqual(ownerCookie, album.owner_token)) return { ok: true }" },
  { name: 'the cookie is read under a fixed name, so one album cookie opens every album',
    from: "  const ownerCookie = (cookieStore.get(`hushare_owner_${album.id}`)?.value ?? '').trim()\n  const ownerPresent = ownerCookie.length > 0",
    to: "  const ownerCookie = (cookieStore.get('hushare_owner')?.value ?? '').trim()\n  const ownerPresent = ownerCookie.length > 0" },

  // ── the signed-in account ────────────────────────────────────────────────────────────────────
  { name: 'BEING SIGNED IN AS ANYBODY counts as owning the album',
    from: "  if (signedInUserId && album.user_id && signedInUserId === album.user_id) return { ok: true }",
    to: "  if (signedInUserId) return { ok: true }" },
  { name: 'a GUEST album (user_id null) is owned by anyone whose session id is also missing',
    from: "  if (signedInUserId && album.user_id && signedInUserId === album.user_id) return { ok: true }",
    to: "  if (signedInUserId === album.user_id) return { ok: true }" },
  { name: 'the account is not accepted at all -- the 163 refused uploads, back',
    from: "  if (signedInUserId && album.user_id && signedInUserId === album.user_id) return { ok: true }\n", to: "" },
  { name: 'the session is looked up even for an OPEN album, costing an auth round trip per upload',
    from: "  if (!album.password_hash && !album.reveal_at) return null\n", to: "" },
  { name: 'a failed session lookup throws out of the gate instead of answering "nobody"',
    from: "    const { data: { user } } = await supabase.auth.getUser()\n    return user?.id ?? null\n  } catch {\n    return null\n  }",
    to: "    const { data: { user } } = await supabase.auth.getUser()\n    return user?.id ?? null\n  } finally {\n    void 0\n  }" },

  // ── the reveal date ──────────────────────────────────────────────────────────────────────────

  // ── the password ─────────────────────────────────────────────────────────────────────────────
  { name: 'a stale cookie and an absent one become the same reason, so the fix for each is guessed',
    from: "    reason: verdict.passwordCookiePresent\n      ? 'password-cookie-stale'\n      : ownerPresent ? 'owner-cookie-mismatch' : 'password-cookie-absent',",
    to: "    reason: 'password-cookie-absent'," },
  { name: 'a stale OWNER LINK is reported as a missing password, so the wrong thing is said to fix it',
    from: "      : ownerPresent ? 'owner-cookie-mismatch' : 'password-cookie-absent',",
    to: "      : 'password-cookie-absent'," },
  { name: 'the reveal refusal is worded as a password one',
    from: "    return { ok: false, error: 'This album has not been revealed yet', reason: 'not-revealed' }",
    to: "    return { ok: false, error: 'Enter the album password before adding photos', reason: 'not-revealed' }" },

  // ── the columns the gate needs ───────────────────────────────────────────────────────────────
  { name: 'the gate columns lose the password hash, so every gated album reads as open',
    from: "export const ALBUM_GATE_COLS = 'owner_token, password_hash, reveal_at, user_id'",
    to: "export const ALBUM_GATE_COLS = 'owner_token, reveal_at, user_id'" },
  { name: 'the gate columns lose user_id, so the signed-in owner can never be recognised',
    from: "export const ALBUM_GATE_COLS = 'owner_token, password_hash, reveal_at, user_id'",
    to: "export const ALBUM_GATE_COLS = 'owner_token, password_hash, reveal_at'" },
  { name: 'the gate columns lose reveal_at, so a sealed album accepts uploads',
    from: "export const ALBUM_GATE_COLS = 'owner_token, password_hash, reveal_at, user_id'",
    to: "export const ALBUM_GATE_COLS = 'owner_token, password_hash, user_id'" },
  ],
}
