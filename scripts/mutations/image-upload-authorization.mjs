// Mutation set for src/lib/server/image-upload-authorization.ts -- run with:
//   node scripts/mutations/run.mjs image-upload-authorization
//
// THE SERVER SIDE OF EVERY GUEST PHOTO. It decides whether a stranger may put bytes into R2 against
// somebody's album, and how many. The failures here divide into two kinds and both are silent:
// letting bytes in that no database row will ever reference (permanent storage, permanent bill, no
// audit can find them), and refusing a guest at an event who is doing nothing wrong.
export default {
  file: 'src/lib/server/image-upload-authorization.ts',
  test: 'tests/image-upload-authorization.test.ts',
  mutations: [
  // ── what may be uploaded at all ──────────────────────────────────────────────────────────────
  { name: 'any content type is accepted, so R2 stores whatever a caller names',
    from: "  if (!isAllowedImage(params.contentType)) {", to: "  if (false) {" },
  { name: 'the type check becomes case-SENSITIVE, so image/JPEG from a phone is refused',
    from: "  if (!isAllowedImage(params.contentType)) {",
    to: "  if (!isAllowedImage(params.contentType) || params.contentType !== params.contentType.toLowerCase()) {" },
  { name: 'the absolute ceiling is gone, so one request reserves an unbounded object',
    from: "  if (params.fileSize !== null && params.fileSize > MAX_FILESIZE_HARD_CAP) {", to: "  if (false) {" },
  { name: 'the ceiling is typed by hand and drifts below a cap a customer was sold',
    from: "const MAX_FILESIZE_HARD_CAP = uploadCapsForTier('studio').image", to: "const MAX_FILESIZE_HARD_CAP = 50 * 1024 * 1024" },
  { name: 'an UNKNOWN size is refused, so every Chrome-on-iOS guest is turned away',
    from: "  if (params.fileSize !== null && params.fileSize > MAX_FILESIZE_HARD_CAP) {",
    to: "  if (params.fileSize === null || params.fileSize > MAX_FILESIZE_HARD_CAP) {" },
  { name: "this album's own tier cap is never applied",
    from: "  if (params.fileSize !== null && params.fileSize > caps.image) {", to: "  if (false) {" },
  { name: 'the cap handed back to the relay is the hard ceiling, not this album tier cap',
    from: "  return { ok: true, tier: tierRes.tier, imageCap: caps.image }", to: "  return { ok: true, tier: tierRes.tier, imageCap: MAX_FILESIZE_HARD_CAP }" },

  // ── which album, and whether it is open ──────────────────────────────────────────────────────
  { name: 'a RETIRED album still takes uploads',
    from: "      .eq('id', params.albumId)\n      .is('retired_at', null)", to: "      .eq('id', params.albumId)" },
  { name: 'the album id is not filtered, so the first album in the table is authorized',
    from: "      .eq('id', params.albumId)\n      .is('retired_at', null)", to: "      .is('retired_at', null)" },
  { name: 'guest uploads being switched OFF is ignored',
    from: "  if (!album.guest_uploads_enabled) {", to: "  if (false) {" },
  // NOT MUTATED -- dropping `albumRes.error ||` is equivalent: supabase-js returns data null
  // whenever error is set, so the `!album` half already answers 404 for every error case.
  { name: 'THE PASSWORD AND REVEAL GATE APPLIES TO VIEWING ONLY, so a stranger uploads into a locked album',
    from: "  if (!gate.ok) {\n    return { ok: false, response: NextResponse.json({ error: gate.error }, { status: 403, headers: NO_STORE }) }\n  }\n", to: "" },
  { name: 'the gate is asked about a different album than the one being written to',
    from: "  const gate = await gateAllowsContribution(album, await cookies(), await signedInUserForGate(album))",
    to: "  const gate = await gateAllowsContribution({ ...album, id: 'other' }, await cookies(), await signedInUserForGate(album))" },

  // ── the limits that stop one album writing bytes nobody can find ─────────────────────────────
  { name: 'the IP limiter OPENS on an outage of its store',
    from: "checkRateLimit(clientIpKey(req, 'presign_ip'), 3600, 12000, { failOpen: false })",
    to: "checkRateLimit(clientIpKey(req, 'presign_ip'), 3600, 12000, { failOpen: true })" },
  { name: 'the IP limit is never consulted',
    from: "  if (!ipRl.ok) {\n    return {\n      ok: false,\n      response: NextResponse.json(\n        { error: 'Too many requests' },",
    to: "  if (false) {\n    return {\n      ok: false,\n      response: NextResponse.json(\n        { error: 'Too many requests' }," },
  { name: 'the per-album limiter OPENS on an outage',
    from: "    presignBudget(countRes.error ? null : countRes.count, albumCap),\n    { failOpen: false },",
    to: "    presignBudget(countRes.error ? null : countRes.count, albumCap),\n    { failOpen: true }," },
  { name: 'the per-album budget goes back to a flat number, about a terabyte an hour per album id',
    from: "    presignBudget(countRes.error ? null : countRes.count, albumCap),", to: "    40000," },
  // NOT MUTATED -- `countRes.error ? null : countRes.count` is equivalent for the same reason:
  // a failed count comes back as null, so both spellings hand presignBudget the same null and it
  // errs open on it. The guard is worth keeping (it states the intent where the question is asked)
  // but no input tells it from its absence.
  { name: 'the album budget is not keyed per album, so every album shares one bucket',
    from: "    `presign_album:${params.albumId}`,", to: "    'presign_album'," },
  { name: 'a 429 arrives with no Retry-After for the IP',
    from: "        { status: 429, headers: { 'Retry-After': String(ipRl.retryAfterSeconds), ...NO_STORE } },",
    to: "        { status: 429, headers: { ...NO_STORE } }," },
  { name: 'a 429 arrives with no Retry-After for the album',
    from: "        { status: 429, headers: { 'Retry-After': String(albumRl.retryAfterSeconds), ...NO_STORE } },",
    to: "        { status: 429, headers: { ...NO_STORE } }," },

  // ── which cap this album actually gets ───────────────────────────────────────────────────────
  { name: 'AN ANONYMOUS ALBUM IS SIZED AS A FREE ACCOUNT, doubling the presign budget for every one alive',
    from: "    ownerTier: album.user_id ? (tierRes.tier ?? 'free') : null,", to: "    ownerTier: tierRes.tier ?? 'free'," },
  { name: 'the budget ignores grandfathering and the override again',
    from: "    createdAt: album.created_at,\n    override: album.media_cap_override,", to: "    createdAt: null,\n    override: null," },
  { name: 'a bought package does not raise the budget it was bought for',
    from: "    pkg: { tier: asPackageTier(album.package_tier), expiresAt: album.package_expires_at },\n  }\n  const { cap: albumCap } = albumCapFor(capInput)",
    to: "    pkg: null,\n  }\n  const { cap: albumCap } = albumCapFor(capInput)" },
  { name: 'the file-size cap treats every package as expired, so a Max-package album is judged as free',
    from: "  const caps = uploadCapsForTier(albumEffectiveTier(album.user_id ? tierRes.tier : null, {\n    tier: asPackageTier(album.package_tier), expiresAt: album.package_expires_at,\n  }))",
    to: "  const caps = uploadCapsForTier(albumEffectiveTier(album.user_id ? tierRes.tier : null, {\n    tier: asPackageTier(album.package_tier), expiresAt: null,\n  }))" },
  // NOT MUTATED for the file-size cap -- `album.user_id ? tierRes.tier : null` is equivalent
  // THERE, because getUserTierById(null) returns 'free' (lib/subscriptions) and albumEffectiveTier
  // treats a 'free' owner and a null owner identically. It is emphatically NOT equivalent in
  // albumCapFor above, where null means the 250-item guest allowance and 'free' means 500 -- which
  // is the mutation two lines up, and the bug the module's own comment records.
  { name: 'a FAILED tier lookup is guessed at instead of refused',
    from: "  if (tierRes.tier === null) {", to: "  if (false) {" },

  // ── the storage key ──────────────────────────────────────────────────────────────────────────
  { name: 'the key is built from the client filename, which is the whole cross-album injection defence',
    from: "  const key = isThumb ? `thumbs/${albumId}/${uuid()}.jpg` : `albums/${albumId}/${uuid()}.${ext}`",
    to: "  const key = isThumb ? `thumbs/${albumId}/${fileName}` : `albums/${albumId}/${fileName}`" },
  { name: 'the key is not scoped to the album, so every album writes into one prefix',
    from: "  const key = isThumb ? `thumbs/${albumId}/${uuid()}.jpg` : `albums/${albumId}/${uuid()}.${ext}`",
    to: "  const key = isThumb ? `thumbs/${uuid()}.jpg` : `albums/${uuid()}.${ext}`" },
  { name: 'the extension comes straight from the filename, not from the allowed-mime map',
    from: "  const ext = isThumb ? 'jpg' : safeExtForMime(normalizedType, rawExt)", to: "  const ext = isThumb ? 'jpg' : rawExt" },
  { name: 'a thumbnail is stored under the original content type rather than as JPEG',
    from: "  const finalContentType = isThumb ? 'image/jpeg' : normalizedType", to: "  const finalContentType = normalizedType" },

  // ── a full album is refused as full, before the budget (2026-09-07 and 2026-09-08) ────────────
  { name: 'A FULL ALBUM IS HANDED A SLOT AGAIN, and its bytes go to R2 to be refused a step later',
    from: "  if (full && capIsSafeToEnforce) {", to: "  if (false) {" },
  // NOT REPEATED -- "a guessed tier enforces the cap" is now the `capIsSafeToEnforce = true` mutation
  // below, which is the same break said once: with the guard gone, a degraded 'free' answer refuses a
  // Max album at 500.
  { name: 'a cap that stopped being enforced is not reported, so nobody learns it stopped',
    from: "    reportServerError('image-upload-auth'", to: "    void ('image-upload-auth'" },
  { name: 'the album is called full one photo early',
    from: "countRes.count >= albumCap", to: "countRes.count >= albumCap - 1" },
  { name: 'the album is called full one photo late',
    from: "countRes.count >= albumCap", to: "countRes.count > albumCap" },
  { name: 'THE REFUSAL GOES BACK TO 429, so our own client retries it and every photo costs four presigns',
    from: "NextResponse.json(albumFullRefusal(capInput), { status: 403, headers: NO_STORE })",
    to: "NextResponse.json(albumFullRefusal(capInput), { status: 429, headers: NO_STORE })" },
  { name: 'the refusal is not the shared one, so the two doors say different things',
    from: "NextResponse.json(albumFullRefusal(capInput), { status: 403, headers: NO_STORE })",
    to: "NextResponse.json({ error: 'Album is full' }, { status: 403, headers: NO_STORE })" },
  { name: "the refusal is worded for a different album's plan",
    from: "albumFullRefusal(capInput)", to: "albumFullRefusal({ ...capInput, ownerTier: 'studio' })" },
  // NOT MUTATED -- `!countRes.error` on its own. The mocked failed count also answers count null, so
  // `countRes.count !== null` already refuses nothing and deleting either half alone is
  // output-identical here. Both stay, because nothing guarantees a real client pairs them.
  // NOT MUTATED -- the ORDER (full check before the budget). A move is not a one-line replacement;
  // the test asserting the budget is never consulted for a full album is what holds it.

  { name: 'THE GATE ASKS THE WRONG QUESTION AGAIN: an override album is not enforced on a degraded lookup',
    from: "  const capIsSafeToEnforce = tierRes.authoritative || !capDependsOnTier(capInput)",
    to: "  const capIsSafeToEnforce = tierRes.authoritative" },
  { name: 'the tier is ignored entirely, so a guessed free cap refuses a Max album',
    from: "  const capIsSafeToEnforce = tierRes.authoritative || !capDependsOnTier(capInput)",
    to: "  const capIsSafeToEnforce = true" },
  { name: 'THE SWITCHED-OFF REFUSAL SENDS THE WRONG SENTENCE, so it is filed as a fault again',
    from: "return { ok: false, response: NextResponse.json({ error: UPLOADS_DISABLED }, { status: 403, headers: NO_STORE }) }",
    to: "return { ok: false, response: NextResponse.json({ error: 'Album not found' }, { status: 403, headers: NO_STORE }) }" },
  ],
}
