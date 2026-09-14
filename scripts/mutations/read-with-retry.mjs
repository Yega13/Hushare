// Mutation set for src/lib/server/read-with-retry.ts -- run with:
//   node scripts/mutations/run.mjs read-with-retry
//
// The retry that stops a one-second database gateway blip becoming an error row every half hour.
// Each mutation below either brings the rows back, delays every healthy read, hammers a gateway that
// is already struggling, or -- the worst -- hides a real outage.
export default {
  file: 'src/lib/server/read-with-retry.ts',
  test: 'tests/read-with-retry.test.ts',
  mutations: [
    { name: 'NO RETRY AT ALL -- every blip is an error row again',
      from: '  while (result.error && made < attempts) {', to: '  while (false && made < attempts) {' },
    { name: 'a third attempt, so a gateway that is down is asked again and the outage takes longer to report',
      from: '  while (result.error && made < attempts) {', to: '  while (result.error && made < attempts + 1) {' },
    { name: 'a healthy read is retried too, doubling the load and the wait on every tick',
      from: '  while (result.error && made < attempts) {', to: '  while (made < attempts) {' },
    { name: 'the retry does not pause, so it lands inside the same blip',
      from: '    await sleep(delayMs)\n', to: '' },
    { name: 'the pause is zero',
      from: 'export const READ_RETRY_DELAY_MS = 3000', to: 'export const READ_RETRY_DELAY_MS = 0' },
    { name: 'the default is a single attempt, which is no retry',
      from: 'export const READ_RETRY_ATTEMPTS = 2', to: 'export const READ_RETRY_ATTEMPTS = 1' },
    { name: 'the retry re-uses the first answer instead of asking again',
      from: '    result = await read()\n    made++', to: '    made++' },
  ],
}
