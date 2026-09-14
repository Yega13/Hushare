// Mutation set for src/lib/album-refresh.ts -- run with: node scripts/mutations/run.mjs album-refresh
//
// Two ways this breaks, and neither is visible on one phone: a refresh that costs two requests again
// (the venue's shared limit is reached at half the crowd), and a refresh that trusts an answer it should
// not (a guest keeps a photo that was deleted, or misses one that arrived).
export default {
  file: 'src/lib/album-refresh.ts',
  test: 'tests/album-refresh.test.ts tests/event-capacity.test.ts',
  mutations: [
    { name: 'EVERY REFRESH PROBES FIRST AGAIN: two requests where one answers',
      from: "  if (seen?.latest) {", to: "  if (false) {" },
    { name: 'an unchanged album is refetched anyway',
      from: "  if (!opts.force && !albumChanged(seen, probe)) return 'unchanged'\n", to: "" },
    { name: 'a forced refresh stops when the counts look the same, so a reorder never lands',
      from: "  if (!opts.force && !albumChanged(seen, probe)) return 'unchanged'", to: "  if (!albumChanged(seen, probe)) return 'unchanged'" },
    { name: 'a SHORT delta is trusted, and a guest keeps a photo that was deleted',
      from: "answer.photos.length === delta", to: "answer.photos.length > 0" },
    { name: 'a delta is applied without remembering it, so the next check fetches it all again',
      from: "    deps.remember(probe)\n    deps.applyDelta(answer)", to: "    deps.applyDelta(answer)" },
    { name: 'a FAILED window is remembered as the current state, so the retry is skipped',
      from: "  if (page && probe) deps.remember(probe)", to: "  if (probe) deps.remember(probe)" },
    { name: 'a failed window is swallowed instead of handed on',
      from: "  deps.applyWindow(page)\n", to: "  if (page) deps.applyWindow(page)\n" },
    { name: 'the since read asks for more rows than a delta can use',
      from: "deps.since(seen.latest, deps.maxDelta)", to: "deps.since(seen.latest, 500)" },
  ],
}
