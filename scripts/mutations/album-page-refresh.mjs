// Mutation set for the refresh wiring in src/app/[slug]/AlbumPageClient.tsx -- run with:
//   node scripts/mutations/run.mjs album-page-refresh
//
// lib/album-refresh decides; these break what the album page hands it, which tests/album-page-wiring pins.
export default {
  file: 'src/app/[slug]/AlbumPageClient.tsx',
  test: 'tests/album-page-wiring.test.ts',
  mutations: [
    { name: 'the refresh never reads what the viewer holds, so every check probes and fetches the window',
      from: "      seen: () => seenFreshnessRef.current,", to: "      seen: () => null," },
    { name: 'the refresh never records what it fetched, so the next check fetches everything again',
      from: "      remember: (freshness) => { seenFreshnessRef.current = freshness },", to: "      remember: () => {}," },
    { name: 'the since request is never made, so every refresh is a failure and a full fetch',
      from: "      since: (since, limit) => fetchSince(albumId, since, limit),", to: "      since: async () => null," },
    { name: 'the window is never fetched, so a deletion never reaches the guest',
      from: "      window: () => fetchPhotos(albumId),", to: "      window: async () => null," },
    { name: "the server's newest time is dropped, so no refresh can ever be a delta",
      from: "        latest: typeof json.latest === 'string' ? json.latest : null,", to: "        latest: null," },
    { name: 'a delta is allowed to grow without limit',
      from: "      maxDelta: ALBUM_DELTA_MAX,", to: "      maxDelta: 100_000," },
    { name: 'the caller\'s force flag is ignored, so a reorder broadcast never lands',
      from: "    }, { force: opts.force === true })", to: "    }, { force: false })" },
  ],
}
