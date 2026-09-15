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
    { name: 'THE RUSSIAN POLICY PROMISES ERASURE WITHIN THE FOLLOWING DAY again',
      from: 'стирается, как правило, в течение суток', to: 'стирается в течение следующих суток' },
    { name: 'the Russian policy stops admitting that a photo deleted before its copy was made cannot be recovered',
      from: 'раньше, чем была сделана её резервная копия', to: 'после того, как была сделана её резервная копия' },
  ],
}
