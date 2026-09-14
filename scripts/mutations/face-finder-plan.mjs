// Mutation set for src/lib/face-finder-plan.ts -- run with:
//   node scripts/mutations/run.mjs face-finder-plan
//
// Each mutation below lets Face Finder skip the server's scan check on an album it has only partly
// seen -- and a runner is told "No matches found" over photos nobody has scanned (rule 20).
export default {
  file: 'src/lib/face-finder-plan.ts',
  test: 'tests/face-finder-plan.test.ts',
  mutations: [
    { name: 'THE LOADED WINDOW IS TAKEN FOR THE WHOLE ALBUM AGAIN',
      from: '  if (!Number.isFinite(albumTotal) || loaded.length < albumTotal) return false', to: '  if (!Number.isFinite(albumTotal)) return false' },
    { name: 'a total it cannot read is believed',
      from: '  if (!Number.isFinite(albumTotal) || loaded.length < albumTotal) return false', to: '  if (loaded.length < albumTotal) return false' },
    { name: 'exactly the whole album is treated as short of it',
      from: 'loaded.length < albumTotal) return false', to: 'loaded.length <= albumTotal) return false' },
    { name: 'videos, which are never scanned, block every skip',
      from: "  const images = loaded.filter((p) => p.media_type !== 'video')", to: '  const images = loaded' },
    { name: 'an album with no images skips to a search over nothing',
      from: '  return images.length > 0 && images.every', to: '  return images.every' },
    { name: 'AN UNSCANNED PHOTO DOES NOT STOP THE SKIP',
      from: 'images.every((p) => p.face_ids != null)', to: 'images.every(() => true)' },
  ],
}
