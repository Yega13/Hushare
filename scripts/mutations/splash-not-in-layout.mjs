// Mutation set for keeping the first-visit splash out of src/app/layout.tsx -- run with:
//   node scripts/mutations/run.mjs splash-not-in-layout
export default {
  file: 'src/app/layout.tsx',
  test: 'tests/splash-home-only.test.ts',
  mutations: [
    { name: 'THE SPLASH IS BACK IN FRONT OF EVERY ALBUM a guest opens from a QR code',
      from: '        <LocaleProvider locale={locale} dict={dict}>',
      to: '        <InitialPreloader />\n        <LocaleProvider locale={locale} dict={dict}>' },
  ],
}
