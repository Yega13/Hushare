// Mutation set for the English privacy policy's backup paragraph -- run with:
//   node scripts/mutations/run.mjs privacy-backup-en
export default {
  file: 'src/app/privacy/content-en.tsx',
  test: 'tests/privacy-backup-retention.test.ts',
  mutations: [
    { name: 'the policy promises a shorter backup than the code keeps',
      from: '<strong style={INK}>31 days</strong>', to: '<strong style={INK}>30 days</strong>' },
    { name: 'the recovery window in the same paragraph disagrees with itself',
      from: 'within those 31 days', to: 'within those 30 days' },
    { name: 'the permanent-deletion sentence names a different number',
      from: 'Once the 31 days have passed', to: 'Once the 7 days have passed' },
  ],
}
