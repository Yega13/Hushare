// Mutation set for isFinalDelivery's tie to QUEUE_MAX_RETRIES -- run with:
//   node scripts/mutations/run.mjs media-backup-final-delivery
//
// Kept apart from media-backup.mjs on purpose. That set also runs tests/architecture.test.ts, whose wrangler.toml
// check kills any changed QUEUE_MAX_RETRIES for an unrelated reason, and a KILLED from there would prove nothing
// about isFinalDelivery. While the constant is 5, a hardcoded 6 behaves exactly like the real rule, so the only
// way to catch the function drifting from the constant is to change the constant the test sees and not the one
// the function reads.
export default {
  file: 'src/lib/server/media-backup.ts',
  test: 'tests/media-backup.test.ts',
  mutations: [
    { name: 'max_retries is raised to 7 and isFinalDelivery still stops at 6 -- "giving up" reaches the panel two deliveries early',
      from: 'export const QUEUE_MAX_RETRIES = 5', to: 'const QUEUE_MAX_RETRIES = 5\nconst RAISED = 7\nexport { RAISED as QUEUE_MAX_RETRIES }' },
  ],
}
