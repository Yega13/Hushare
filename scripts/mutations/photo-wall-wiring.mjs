// Mutation set for the photos channel wiring in src/components/PhotoWall.tsx -- run with:
//   node scripts/mutations/run.mjs photo-wall-wiring
//
// The rules live in lib/realtime-supervisor and are proven there. What the wall can still get wrong is
// the handful of arguments it hands over, and each of these is a frozen or leaking wall on a projector.
export default {
  file: 'src/components/PhotoWall.tsx',
  test: 'tests/photo-wall-wiring.test.ts',
  mutations: [
    { name: 'the wall listens on the wrong topic, so it never hears an upload',
      from: "supabase.channel(`album:${albumId}`)", to: "supabase.channel('album')" },
    { name: 'a change never refreshes the wall',
      from: "      refresh: () => { void refetch() },", to: "      refresh: () => {}," },
    { name: 'the wall never removes its channel, so every remount leaks a subscription',
      from: "      remove: (ch) => { supabase.removeChannel(ch) },", to: "      remove: () => {}," },
    { name: 'the effect drops the cleanup, so the watch outlives the wall',
      from: "    return watchPhotosChannel({", to: "    watchPhotosChannel({" },
    { name: 'the wall debounce is not the wall constant',
      from: "      debounceMs: WALL_REFETCH_DEBOUNCE_MS,", to: "      debounceMs: 60_000," },
    { name: 'the wall waits ten times longer than it should to feel live',
      from: "const WALL_REFETCH_DEBOUNCE_MS = 500", to: "const WALL_REFETCH_DEBOUNCE_MS = 5000" },
  ],
}
