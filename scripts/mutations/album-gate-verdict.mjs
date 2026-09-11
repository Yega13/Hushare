// Mutation set for albumGateVerdict in src/lib/server/album-access.ts -- run with:
//   node scripts/mutations/run.mjs album-gate-verdict
//
// THE ONE GATE, NOW ASKED THREE TIMES. Until 2026-09-11 this rule was written out three times in
// this file -- once for whether the page renders, once for whether somebody may add to the album,
// once for whether the photos list -- and three copies of a rule are three chances to fix two of
// them (rule 13). The mutation sets could not even say which copy they meant without a line of
// surrounding context.
//
// THE TEST LIST IS THE POINT OF THIS SET. Every mutation below is run against all three callers'
// test files at once, so a single break in the shared rule has to be caught by the page test, the
// upload test AND the photo-listing test. That is the property the merge bought: one decision, held
// from three directions.
export default {
  file: 'src/lib/server/album-access.ts',
  test: 'tests/album-resolve-gate.test.ts tests/photo-listing-gate.test.ts tests/contribution-gate.test.ts tests/gates-and-money.test.ts',
  mutations: [
  { name: 'THE GATE ALWAYS OPENS -- password, reveal and all three callers at once',
    from: "): Promise<GateVerdict> {\n  if (isOwner) return { pass: true }",
    to: "): Promise<GateVerdict> {\n  return { pass: true }" },
  { name: 'the gate never opens, so every album is locked to everyone',
    from: "  return { pass: true }\n}\n\nexport async function gateAllowsContribution(",
    to: "  return { pass: false, blockedBy: 'password', passwordCookiePresent: false }\n}\n\nexport async function gateAllowsContribution(" },
  { name: 'the owner is not let past, so an owner is refused on their own album',
    from: "  if (isOwner) return { pass: true }", to: "  if (false) return { pass: true }" },
  { name: 'ANYONE is let past as if they were the owner',
    from: "  if (isOwner) return { pass: true }", to: "  if (!isOwner) return { pass: true }" },

  // ── the reveal date ──────────────────────────────────────────────────────────────────────────
  { name: 'a SEALED album opens before its date',
    from: "  if (revealPending(album)) return { pass: false, blockedBy: 'reveal' }\n", to: "" },
  { name: 'a reveal refusal is reported as a password one, so all three callers say the wrong thing',
    from: "return { pass: false, blockedBy: 'reveal' }",
    to: "return { pass: false, blockedBy: 'password', passwordCookiePresent: false }" },

  { name: 'PASSWORD BEFORE REVEAL, so somebody holding the password opens a sealed album early',
    from: "  if (revealPending(album)) return { pass: false, blockedBy: 'reveal' }",
    to: "  if (!album.password_hash && revealPending(album)) return { pass: false, blockedBy: 'reveal' }" },
  { name: 'the shared reveal predicate always says no, so nothing is ever sealed',
    from: "  return !!album.reveal_at && new Date(album.reveal_at) > new Date()", to: "  return false" },
  { name: 'the shared reveal predicate inverts, so a revealed album is sealed forever',
    from: "  return !!album.reveal_at && new Date(album.reveal_at) > new Date()",
    to: "  return !!album.reveal_at && new Date(album.reveal_at) < new Date()" },

  // ── the password ─────────────────────────────────────────────────────────────────────────────
  { name: 'THE PASSWORD IS NOT CHECKED, so knowing the album is enough everywhere at once',
    from: "  if (album.password_hash) {", to: "  if (false) {" },
  { name: 'holding ANY password cookie counts as unlocked',
    from: "    const unlocked = pwCookie.length > 0\n      ? await verifyAccessToken(pwCookie, album.password_hash, album.id)\n      : false",
    to: "    const unlocked = pwCookie.length > 0" },
  { name: "another album's password cookie unlocks this one",
    from: "      ? await verifyAccessToken(pwCookie, album.password_hash, album.id)",
    to: "      ? await verifyAccessToken(pwCookie, album.password_hash, 'any-album')" },
  { name: 'the password cookie is read under a fixed name, so unlocking one album unlocks all',
    from: "    const pwCookie = cookieStore.get(`hushare_pw_${album.id}`)?.value ?? ''\n    const unlocked",
    to: "    const pwCookie = cookieStore.get('hushare_pw')?.value ?? ''\n    const unlocked" },
  { name: 'a failed unlock falls through to a pass',
    from: "    if (!unlocked) return { pass: false, blockedBy: 'password', passwordCookiePresent: pwCookie.length > 0 }\n", to: "" },

  // ── the one thing the verdict deliberately does NOT decide ───────────────────────────────────
  { name: 'a STALE password cookie reads as an absent one, so the upload says the wrong sentence',
    from: "passwordCookiePresent: pwCookie.length > 0 }", to: "passwordCookiePresent: false }" },
  { name: 'an ABSENT cookie reads as a stale one, and a stale owner link can no longer be told apart',
    from: "passwordCookiePresent: pwCookie.length > 0 }", to: "passwordCookiePresent: true }" },
  ],
}
