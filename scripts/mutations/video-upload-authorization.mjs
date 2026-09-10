// Mutation set for src/lib/server/video-upload-authorization.ts -- run with:
//   node scripts/mutations/run.mjs video-upload-authorization
//
// THE SERVER SIDE OF EVERY GUEST VIDEO, and the only place the album's minute pool is enforced
// before Cloudflare is asked to reserve anything. Cloudflare Stream storage is a PURCHASED ceiling:
// exceeding it does not cost more, it makes every video upload fail for every album. So a hole here
// is not a bill, it is an outage for everybody. The other direction is a guest at an event being
// refused a clip the album has room for.
export default {
  file: 'src/lib/server/video-upload-authorization.ts',
  test: 'tests/video-upload-authorization.test.ts',
  mutations: [
  // ── what may be uploaded at all, and in what order ───────────────────────────────────────────
  { name: 'any content type is accepted as video',
    from: "  if (!isAllowedVideo(params.contentType)) {", to: "  if (false) {" },
  { name: 'the type check becomes case-SENSITIVE, so video/MP4 from a phone is refused',
    from: "  if (!isAllowedVideo(params.contentType)) {",
    to: "  if (!isAllowedVideo(params.contentType) || params.contentType !== params.contentType.toLowerCase()) {" },
  { name: 'the absolute ceiling is gone',
    from: "  if (params.fileSize > MAX_VIDEO_HARD_CAP) {", to: "  if (false) {" },
  { name: 'the ceiling is typed by hand and drifts below a cap a customer was sold',
    from: "const MAX_VIDEO_HARD_CAP = STUDIO_VIDEO_BYTES", to: "const MAX_VIDEO_HARD_CAP = 200 * 1024 * 1024" },
  { name: "this album's own tier cap is never applied to the file size",
    from: "  if (params.fileSize > caps.video) {", to: "  if (false) {" },

  // ── which album, and whether it is open ──────────────────────────────────────────────────────
  { name: 'a RETIRED album still takes video uploads',
    from: "    .eq('id', params.albumId)\n    .is('retired_at', null)", to: "    .eq('id', params.albumId)" },
  { name: 'the album id is not filtered',
    from: "    .eq('id', params.albumId)\n    .is('retired_at', null)", to: "    .is('retired_at', null)" },
  { name: 'guest uploads being switched OFF is ignored',
    from: "  if (!album.guest_uploads_enabled) {", to: "  if (false) {" },
  // NOT MUTATED -- dropping `albumError ||` is equivalent: supabase-js returns data null whenever
  // error is set, so the `!album` half already answers 404 for every error case.
  { name: 'THE PASSWORD AND REVEAL GATE APPLIES TO VIEWING ONLY, so a stranger uploads into a locked album',
    from: "  if (!gate.ok) {\n    return { ok: false, response: NextResponse.json({ error: gate.error }, { status: 403, headers: NO_STORE }) }\n  }\n", to: "" },
  { name: 'the gate is asked about a different album than the one being written to',
    from: "  const gate = await gateAllowsContribution(album, await cookies(), await signedInUserForGate(album))",
    to: "  const gate = await gateAllowsContribution({ ...album, id: 'other' }, await cookies(), await signedInUserForGate(album))" },

  // ── the rate limit in front of the tier lookup ───────────────────────────────────────────────
  { name: 'the album limiter OPENS on an outage of its store',
    from: "checkRateLimit(`stream_album:${params.albumId}`, 3600, 4000, { failOpen: false })",
    to: "checkRateLimit(`stream_album:${params.albumId}`, 3600, 4000, { failOpen: true })" },
  { name: 'the limiter is not keyed per album, so every album shares one bucket',
    from: "checkRateLimit(`stream_album:${params.albumId}`, 3600, 4000, { failOpen: false })",
    to: "checkRateLimit('stream_album', 3600, 4000, { failOpen: false })" },
  { name: 'the 429 arrives with no Retry-After',
    from: "        { status: 429, headers: { 'Retry-After': String(albumRl.retryAfterSeconds), ...NO_STORE } },",
    to: "        { status: 429, headers: { ...NO_STORE } }," },

  // ── which tier the album counts as ───────────────────────────────────────────────────────────
  { name: 'a FAILED tier lookup is guessed at instead of refused',
    from: "    tier = await getUserTierById(album.user_id)\n  } catch (e) {", to: "    tier = await getUserTierById(album.user_id).catch(() => 'free')\n  } catch (e) {" },
  // NOT MUTATED -- `album.user_id ? tier : null` is equivalent HERE: getUserTierById(null) returns
  // 'free' (lib/subscriptions) and albumEffectiveTier treats a 'free' owner and a null owner
  // identically. It is NOT equivalent in the image path's albumCapFor, where null means the
  // 250-item guest allowance and 'free' means 500 -- which is a live mutation over there.
  { name: 'a bought package does not raise the album budget it was sold with',
    from: "  const effectiveTier = albumEffectiveTier(album.user_id ? tier : null, {\n    tier: asPackageTier(album.package_tier), expiresAt: album.package_expires_at,\n  })",
    to: "  const effectiveTier = albumEffectiveTier(album.user_id ? tier : null, null)" },
  { name: 'the minute pool is sized from the OWNER account rather than the album',
    from: "  const vcaps = videoCaps(effectiveTier)", to: "  const vcaps = videoCaps(album.user_id ? tier : null)" },

  // ── the minute pool itself ───────────────────────────────────────────────────────────────────
  { name: 'THE BUDGET IS NEVER ENFORCED: every album may fill the shared Stream ceiling',
    from: "    if (videoBudgetExceeded(usedSeconds, params.durationSeconds, vcaps)) {", to: "    if (false) {" },
  { name: 'the budget is asked about a zero-length clip, so nothing is ever over',
    from: "    if (videoBudgetExceeded(usedSeconds, params.durationSeconds, vcaps)) {",
    to: "    if (videoBudgetExceeded(usedSeconds, 0, vcaps)) {" },
  { name: 'the total is read as an empty album rather than as THIS album',
    from: "    .rpc('album_video_seconds', { p_album_id: params.albumId })", to: "    .rpc('album_video_seconds', { p_album_id: '00000000-0000-0000-0000-000000000000' })" },
  { name: 'a total that is not a usable number is read as zero seconds used',
    from: "  const unusable = !videoSumErr && (usedFromDb == null || !Number.isFinite(usedFromDbNum) || usedFromDbNum < 0)",
    to: "  const unusable = false" },
  { name: 'a NEGATIVE total is trusted, so one bad row disables the budget permanently',
    from: "|| !Number.isFinite(usedFromDbNum) || usedFromDbNum < 0)", to: "|| !Number.isFinite(usedFromDbNum))" },
  { name: 'a bigint arriving as a string is rejected as unusable, so the budget stops enforcing',
    from: "  const usedFromDbNum = Number(usedFromDb)", to: "  const usedFromDbNum = typeof usedFromDb === 'number' ? usedFromDb : NaN" },
  { name: 'a budget that has silently stopped being enforced never reaches the panel',
    from: "    reportServerError('stream', 'Video budget NOT enforced — the duration query failed', {\n      albumId: params.albumId,\n      context: { reason: reason.slice(0, 200) },\n    })\n", to: "" },
  { name: 'a full album is refused with 429, which the uploader retries four more times',
    from: "          { status: 403, headers: NO_STORE },\n        ),\n      }\n    }\n  }", to: "          { status: 429, headers: NO_STORE },\n        ),\n      }\n    }\n  }" },
  { name: 'the refusal carries no code, so the client cannot tell it from a fault',
    from: "          { code: 'album_video_full', error: videoAlbumFullMessage(vcaps, usedSeconds) },",
    to: "          { error: videoAlbumFullMessage(vcaps, usedSeconds) }," },

  // ── what the caller is handed for the atomic booking ─────────────────────────────────────────
  { name: 'the booking ceiling is re-derived from the owner tier instead of the album',
    from: "    budgetSeconds: vcaps.maxTotalSeconds,", to: "    budgetSeconds: videoCaps(tier).maxTotalSeconds," },
  { name: 'the reservation is CLAMPED to the budget, so a long clip dies at 100% during processing',
    from: "    maxDurationSeconds: resolveMaxDurationSeconds(params.durationSeconds),",
    to: "    maxDurationSeconds: Math.min(resolveMaxDurationSeconds(params.durationSeconds), vcaps.maxTotalSeconds)," },
  { name: 'the reservation is the clip length itself, with no headroom',
    from: "    maxDurationSeconds: resolveMaxDurationSeconds(params.durationSeconds),",
    to: "    maxDurationSeconds: Number(params.durationSeconds) || 900," },
  ],
}
