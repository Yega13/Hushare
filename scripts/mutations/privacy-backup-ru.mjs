// Mutation set for the Russian privacy policy's backup paragraph -- run with:
//   node scripts/mutations/run.mjs privacy-backup-ru
export default {
  file: 'src/app/privacy/content-ru.tsx',
  test: 'tests/privacy-backup-retention.test.ts',
  mutations: [
    { name: 'the Russian policy promises a different backup period',
      from: 'их копия ещё 31 день хранится', to: 'их копия ещё 21 день хранится' },
    { name: 'the Russian permanent-deletion sentence names a different number',
      from: 'По истечении 31 дня', to: 'По истечении 1 дня' },
  ],
}
