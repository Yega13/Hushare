// Mutation set for the photos channel wiring in src/app/[slug]/AlbumPageClient.tsx -- run with:
//   node scripts/mutations/run.mjs album-page-channel
//
// The channel's rules are lib/realtime-supervisor's and are proven there (tests/realtime-supervisor).
// These break the arguments the album page hands to it, which tests/album-page-wiring pins by name.
export default {
  file: 'src/app/[slug]/AlbumPageClient.tsx',
  test: 'tests/album-page-wiring.test.ts',
  mutations: [
    { name: 'the album page listens on the wrong topic, so no guest ever sees an upload arrive',
      from: "supabase.channel(`album:${albumId}`).on('broadcast', { event: 'changed' }, onChanged)",
      to: "supabase.channel('album').on('broadcast', { event: 'changed' }, onChanged)" },
    { name: 'the album page never removes its channel, so every album switch leaks a subscription',
      from: "      remove: (ch) => { supabase.removeChannel(ch) },", to: "      remove: () => {}," },
    { name: 'every broadcast forces a full window fetch (the forced-refresh rate limit is bypassed)',
      from: "applyWindowRefresh(r) }, { force }) },", to: "applyWindowRefresh(r) }, { force: true }) }," },
    { name: 'the refresh no longer checks the page is still mounted before applying',
      from: "      refresh: ({ force }) => { void refreshIfChanged(albumId, r => { if (active) applyWindowRefresh(r) }, { force }) },",
      to: "      refresh: ({ force }) => { void refreshIfChanged(albumId, r => { applyWindowRefresh(r) }, { force }) }," },
    { name: 'the debounce is not the album constant, so a room of phones refetches on every ping',
      from: "      debounceMs: REFETCH_DEBOUNCE_MS,\n    })\n\n    return () => {",
      to: "      debounceMs: 0,\n    })\n\n    return () => {" },
    { name: 'cleanup never stops the watch, so its timers and socket outlive the album',
      from: "      active = false\n      stop()\n", to: "      active = false\n" },
    { name: 'cleanup leaves a refresh in flight free to apply to an album that is gone',
      from: "      active = false\n      stop()\n", to: "      stop()\n" },
  ],
}
