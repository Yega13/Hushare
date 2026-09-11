// Mutations for the bib-exclusions route — the wiring between lib/bib-exclusions and the column.
//
// The module's own set (bib-exclusions.mjs) proves the decisions. None of it says anything about
// the two lines that decide whether they run, which is MISTAKES entry 10 recorded six times in this
// codebase. Every mutation below leaves the module untouched and breaks the route.
//
// The one that matters most is the gate direction. This route can hide a runner's own photographs
// from them, and that mistake produces no complaint: the runner looks, finds nothing, and concludes
// they were not photographed. So an owner who has left the plan must still be able to undo it.
export default {
  file: 'src/app/api/album/bib-exclusions/route.ts',
  test: 'tests/route-wiring-bib-exclusions.test.ts',
  mutations: [
    {
      name: 'the gate runs in BOTH directions — a wrong exclusion freezes onto the album forever',
      from: '  if (addsSomething) {',
      to: '  if (true) {',
    },
    {
      name: 'the gate never runs — the paid feature is free',
      from: '  if (addsSomething) {',
      to: '  if (false) {',
    },
    {
      name: 'additions are detected by LENGTH, so swapping one number for another slips past',
      from: '  const addsSomething = next.some((n) => !isExcludedNumber(n, current))',
      to: '  const addsSomething = next.length > current.length',
    },
    {
      name: 'the payload is stored raw, so 02026 never matches the stored 2026',
      from: '  const next = normalizeExclusions(excluded)',
      to: '  const next = excluded as string[]',
    },
    {
      name: 'guests with the album open are never told, and keep seeing the banner',
      from: '  queueAlbumSettingsBroadcast(access.album.id, { bib_excluded_numbers: next })',
      to: '  void next',
    },
    {
      name: 'the broadcast carries what was POSTED rather than what was stored',
      from: 'queueAlbumSettingsBroadcast(access.album.id, { bib_excluded_numbers: next })',
      to: 'queueAlbumSettingsBroadcast(access.album.id, { bib_excluded_numbers: excluded })',
    },
    {
      // Anchored to the UPDATE. `if (error) { return serverError` appears in both handlers, and the
      // runner refused the mutation as AMBIGUOUS rather than landing it on whichever came first --
      // the guard written after MISTAKES 19/20 doing its job.
      name: 'a failed write is reported as a success',
      from: "    .eq('id', access.album.id)\n  if (error) {",
      to: "    .eq('id', access.album.id)\n  if (false) {",
    },
    {
      name: 'a non-array body is accepted and reaches normalizeExclusions',
      from: '  if (!Array.isArray(excluded)) {',
      to: '  if (false) {',
    },
    {
      name: 'the candidate list is returned unranked and unfiltered, straight from SQL',
      from: '    { rows: exclusionRows(tallies, excluded), excluded },',
      to: '    { rows: tallies, excluded },',
    },
    {
      name: 'the thumbnail is dropped in transit, so every row is a bare number again',
      from: '    number: r.number, photos: Number(r.photos), sampleThumb: r.sample_thumb,',
      to: '    number: r.number, photos: Number(r.photos), sampleThumb: null,',
    },
    {
      name: 'the excluded list is not passed in, so an excluded number is offered as a candidate forever',
      from: '    { rows: exclusionRows(tallies, excluded), excluded },',
      to: '    { rows: exclusionRows(tallies, []), excluded },',
    },
    {
      name: 'the gate compares numbers as TEXT, so a removal is refused below plan (rule 19, wrong way)',
      from: '  const addsSomething = next.some((n) => !isExcludedNumber(n, current))',
      to: '  const addsSomething = next.some((n) => !current.includes(n))',
    },
    {
      name: 'a list past the ceiling is truncated silently, so the tapped number springs back on',
      from: '  if (distinctKeys > MAX_EXCLUSIONS) {',
      to: '  if (false) {',
    },
    {
      name: 'the ceiling refuses a list that exactly fits, blocking a legitimate save',
      from: '  if (distinctKeys > MAX_EXCLUSIONS) {',
      to: '  if (distinctKeys >= MAX_EXCLUSIONS) {',
    },
    {
      name: 'the ceiling counts SPELLINGS, so a padded resend is refused over a limit not reached',
      from: '      .map(numericKey).filter((k): k is string => k !== null),',
      to: '      .map((n) => n),',
    },
    {
      name: 'a failed tally is presented as an album with no signage',
      from: '  if (error) {\n    return serverError(\'album/bib-exclusions\', error.message, {\n      albumId: access.album.id, publicMessage: \'Could not read this album\\\'s numbers\',',
      to: '  if (false) {\n    return serverError(\'album/bib-exclusions\', error.message, {\n      albumId: access.album.id, publicMessage: \'Could not read this album\\\'s numbers\',',
    },
    {
      name: 'the owner check is skipped on the read',
      from: '  if (!access.ok) return refuseAccess(access)\n\n  const admin = createAdminClient()\n  const { data, error } = await admin.rpc',
      to: '  if (false) return refuseAccess(access)\n\n  const admin = createAdminClient()\n  const { data, error } = await admin.rpc',
    },
  ],
}
