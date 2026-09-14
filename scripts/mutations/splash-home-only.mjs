// Mutation set for the first-visit splash on the home page, src/app/page.tsx -- run with:
//   node scripts/mutations/run.mjs splash-home-only
export default {
  file: 'src/app/page.tsx',
  test: 'tests/splash-home-only.test.ts',
  mutations: [
    { name: 'THE HOME PAGE HIDES ITSELF WITH NOTHING TO REVEAL IT -- the component is gone, the script stays',
      from: '      <InitialPreloader />\n', to: '' },
    { name: 'the splash appears without hiding the page behind it first',
      from: '      <script dangerouslySetInnerHTML={{ __html: PRELOADER_INIT_SCRIPT }} />\n', to: '' },
    { name: 'the script checks a different flag than the component sets, so the splash shows on every visit',
      from: "window.localStorage.getItem('hushare.initialPreloaderSeen')", to: "window.localStorage.getItem('hushare.splashSeen')" },
  ],
}
