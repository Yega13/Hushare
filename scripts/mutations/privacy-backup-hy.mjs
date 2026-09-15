// Mutation set for the Armenian privacy policy's backup paragraph -- run with:
//   node scripts/mutations/run.mjs privacy-backup-hy
//
// The paragraph is the owner's own translation. These mutations only change a number or delete a phrase,
// so nothing here composes Armenian.
export default {
  file: 'src/app/privacy/content-hy.tsx',
  test: 'tests/privacy-backup-retention.test.ts',
  mutations: [
    { name: 'the Armenian policy promises a different backup period',
      from: 'դրանց պատճենը 31 օր պահվում է', to: 'դրանց պատճենը 30 օր պահվում է' },
    { name: 'the Armenian permanent-deletion sentence names a different number',
      from: 'Երբ 31 օրը լրանա', to: 'Երբ 7 օրը լրանա' },
    { name: 'THE ARMENIAN POLICY DROPS "NORMALLY", promising erasure within a day without exception',
      from: 'սովորաբար մեկ օրվա ընթացքում', to: 'մեկ օրվա ընթացքում' },
    { name: 'the Armenian policy stops admitting that a photo deleted before its copy was made cannot be recovered',
      from: 'մինչև դրա պահուստային պատճենի ստեղծումը', to: 'դրա պահուստային պատճենի ստեղծումը' },
  ],
}
