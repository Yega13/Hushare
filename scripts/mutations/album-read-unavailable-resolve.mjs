// Mutation set for the failed-read branch of resolveAlbum in src/lib/server/album-access.ts -- run with:
//   node scripts/mutations/run.mjs album-read-unavailable-resolve
//
// Each mutation below turns a database blip back into "this album does not exist" on the QR scan, or
// hides it from the panel, or makes the guest wait the crons' 3 seconds for a retry.
export default {
  file: 'src/lib/server/album-access.ts',
  test: 'tests/album-resolve-gate.test.ts',
  mutations: [
    { name: 'A FAILED READ IS A MISSING ALBUM AGAIN -- a 404 on the QR scan',
      from: "  if (readError) {\n    reportServerError('album-access', 'Album read failed', { context: { step: 'resolve'",
      to: "  if (false) {\n    reportServerError('album-access', 'Album read failed', { context: { step: 'resolve'" },
    { name: 'a single blip is not retried',
      from: '.limit(2), { delayMs: ALBUM_READ_RETRY_DELAY_MS })', to: '.limit(2), { attempts: 1 })' },
    { name: 'the failure is never reported',
      from: "    reportServerError('album-access', 'Album read failed', { context: { step: 'resolve', reason: readError.message.slice(0, 300) } })\n", to: '' },
    { name: 'the page waits 3 seconds for its retry, like a cron',
      from: 'export const ALBUM_READ_RETRY_DELAY_MS = 250', to: 'export const ALBUM_READ_RETRY_DELAY_MS = 3000' },
  ],
}
