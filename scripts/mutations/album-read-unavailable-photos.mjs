// Mutation set for the failed-read branch of fetchAuthorizedPhotos in src/lib/server/album-access.ts -- run with:
//   node scripts/mutations/run.mjs album-read-unavailable-photos
export default {
  file: 'src/lib/server/album-access.ts',
  test: 'tests/photo-listing-gate.test.ts',
  mutations: [
    { name: 'A FAILED ALBUM READ ANSWERS "NOT FOUND" TO THE PHOTO LISTING',
      from: "  if (readError) {\n    reportServerError('album-access', 'Album read failed', { albumId, context: { step: 'photos'",
      to: "  if (false) {\n    reportServerError('album-access', 'Album read failed', { albumId, context: { step: 'photos'" },
    { name: 'a single blip on the photo listing is not retried',
      from: '.maybeSingle(), { delayMs: ALBUM_READ_RETRY_DELAY_MS })', to: '.maybeSingle(), { attempts: 1 })' },
    { name: 'the photo listing failure is never reported',
      from: "    reportServerError('album-access', 'Album read failed', { albumId, context: { step: 'photos', reason: readError.message.slice(0, 300) } })\n", to: '' },
  ],
}
