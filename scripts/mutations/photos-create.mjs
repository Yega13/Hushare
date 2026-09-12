// Mutation set for src/app/api/album/photos/create/route.ts -- run with:
//   node scripts/mutations/run.mjs photos-create
//
// THE ROUTE THAT TURNS UPLOADED BYTES INTO ROWS, AND THE LAST ONE WITH NO SET AT ALL.
//
// Until tests/route-wiring-photos-create.test.ts existed, nothing executed a line of this file:
// eight test files mention it and every one reads it as TEXT (stream-token.test.ts matches regexes
// against the source, album-entitlements.test.ts asserts the file CONTAINS `albumFullRefusal(`).
// A regex proves a call is WRITTEN. It cannot prove the call is reached, that its answer is used,
// or that nothing is written when it refuses -- which is the whole of what a refusal is.
//
// So this set exists to answer one question about that new test file: can it fail? It was green on
// its first run, against a mock written by the same hand, which is the exact shape route-wiring-
// stream.test.ts records in its own header -- `if (false)` on that route's per-IP limit survived
// all ten of its tests, because the mock always said yes and nobody looked.
//
// Each mutation below removes one rung of the refusal ladder. Every one of them, shipped, is a
// guest's photos going somewhere they were refused -- or an attacker's rows landing in an album
// whose password was changed specifically to stop them.
export default {
  file: 'src/app/api/album/photos/create/route.ts',
  test: 'tests/route-wiring-photos-create.test.ts',
  mutations: [
    // ── the guards that must run BEFORE anything is looked up ──────────────────────────────────
    { name: 'the cross-site check is decorative (any origin may post rows)',
      from: '  if (csrfError) return csrfError', to: '  if (false) return csrfError' },
    { name: 'the per-IP rate limit never refuses',
      from: '  if (!ipRl.ok) {', to: '  if (false) {' },

    // ── the input validation, whose failure mode is a poisoned thumb_url ───────────────────────
    // A row whose thumb_url points at ANOTHER photo's file turns the owner's own delete click into
    // the destruction of their originals. photo-input.ts documents the attack; this asserts the
    // route still refuses the whole batch rather than writing the good rows beside the bad one.
    { name: 'a photo that fails validation is skipped instead of refusing the call',
      from: '    if (err) return NextResponse.json({ error: err }, { status: 400, headers: NO_STORE })\n', to: '' },

    // ── the album itself ───────────────────────────────────────────────────────────────────────
    { name: 'a missing (or retired) album is not refused',
      from: '  if (!album) {', to: '  if (false) {' },
    { name: 'an album with guest uploads switched OFF still accepts them',
      from: '  if (!album.guest_uploads_enabled) {', to: '  if (false) {' },

    // ── the contribution gate: the one that was advisory, and cost 163 uploads ─────────────────
    { name: 'THE PASSWORD/REVEAL GATE IS ADVISORY AGAIN -- knowing the album id is enough to post rows',
      from: '  if (!uploadGate.ok) {', to: '  if (false) {' },
    { name: "the gate's own refusal is replaced by a message of the route's own",
      from: "    return NextResponse.json({ error: uploadGate.error }, { status: 403, headers: NO_STORE })",
      to:   "    return NextResponse.json({ error: 'Upload refused' }, { status: 403, headers: NO_STORE })" },

    // ── the per-album limit ────────────────────────────────────────────────────────────────────
    { name: 'the per-album rate limit never refuses',
      from: '  if (!albumRl.ok) {', to: '  if (false) {' },

    // ── the cap ────────────────────────────────────────────────────────────────────────────────
    // A longer anchor on purpose: `photoCount >= cap` also matches the nudge's
    // `photoCount >= cap * 0.8` a few lines below, and an ambiguous anchor is a mutation that
    // silently applies to the wrong line.
    { name: 'the cap refuses one photo LATE, so every full album takes one more',
      from: '&& photoCount >= cap) {', to: '&& photoCount > cap) {' },

    // ── and the direction the uncertain branch errs in (rule 19) ───────────────────────────────
    // The route says a failed count must NOT block an event. Making it refuse is the plausible
    // "safer" change somebody would write, and it is the wrong one: it turns a database blip into
    // every guest at a wedding being told they cannot upload.
    { name: 'A FAILED COUNT NOW BLOCKS THE UPLOAD instead of allowing it (rule 19, reversed)',
      from: "  if (countErr) {\n    console.error('[photos/create] media cap NOT enforced — count failed for album', albumId, ':', countErr.message)\n  }",
      to:   "  if (countErr) {\n    return NextResponse.json({ error: 'Service error' }, { status: 503, headers: NO_STORE })\n  }" },
  ],
}
