// Mutation set for loadAlbumPage in src/lib/server/album-access.ts -- run with:
//   node scripts/mutations/run.mjs album-page-load
//
// THE ALBUM PAGE'S ONE LOAD. Faster only counts if who-sees-what did not move with it, so this set
// breaks both halves: the order the reads run in (a sequential chain is exactly the slowness the
// review measured, and it would pass every correctness test), and the owner rule for the photos.
export default {
  file: 'src/lib/server/album-access.ts',
  test: 'tests/album-page-load.test.ts',
  mutations: [
    // ── the speed ────────────────────────────────────────────────────────────────────────────────
    { name: "THE OWNER'S PLAN IS AWAITED BEFORE THE PHOTOS START -- the chain the review measured",
      from: "  const [ownerTier, firstWindow] = await Promise.all([\n    getUserTierById(album.user_id),\n",
      to: "  const tierFirst = await getUserTierById(album.user_id)\n  const [ownerTier, firstWindow] = await Promise.all([\n    tierFirst,\n" },
    { name: 'the page asks for its total in a second request instead of with the rows',
      from: "recent: null, bibCandidates: null, countWithRows: true }))",
      to: "recent: null, bibCandidates: null, countWithRows: false }))" },
    { name: 'the total that came back with the rows is ignored, so a big album says it has one window',
      from: "    total = countedWithRows ?? offset + got\n",
      to: "    total = offset + got\n" },

    // ── who sees what ────────────────────────────────────────────────────────────────────────────
    { name: 'A GUEST IS TREATED AS THE OWNER for the photos, so hidden photos reach the page',
      from: "      .then((owner) => readPhotoWindow(admin, album, owner, {",
      to: "      .then(() => readPhotoWindow(admin, album, true, {" },
    { name: 'the owner cookie is never honoured for the photos, so an owner cannot review their own album',
      from: "      .then((owner) => readPhotoWindow(admin, album, owner, {",
      to: "      .then(() => readPhotoWindow(admin, album, false, {" },
    { name: 'ANY owner cookie counts, without comparing it to the token',
      from: "    return !!ownerRow && timingSafeEqual(ownerCookie, ownerRow.owner_token)\n",
      to: "    return !!ownerRow\n" },
    { name: 'the raw row reaches the browser, password hash and account id included',
      from: "    album: publishAlbum(album, ownerTier, isOwner),\n",
      to: "    album: album as unknown as Album,\n" },

    // ── a database that blinks ───────────────────────────────────────────────────────────────────
    { name: 'A FAILED PHOTO READ FAILS THE WHOLE PAGE instead of rendering the album',
      from: "      .catch((e: unknown) => {\n        reportServerError('album-access', 'Album page photo read failed'",
      to: "      .catch((e: unknown) => {\n        throw e\n        reportServerError('album-access', 'Album page photo read failed'" },
    { name: 'a failed photo read is swallowed without a report',
      from: "        reportServerError('album-access', 'Album page photo read failed', { albumId: album.id, context: { reason: e instanceof Error ? e.message : String(e) } })\n",
      to: "" },
  ],
}
