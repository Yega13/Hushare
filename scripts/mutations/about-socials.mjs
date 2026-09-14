// Mutations proving the one-place rule can actually see /about.
//
// tests/social-profiles scans src for the handle. These put a hand-typed copy back into the page the
// drift was found on, which is the exact regression the scan exists to catch.
export default {
  file: 'src/app/about/page.tsx',
  test: 'tests/social-profiles.test.ts',
  mutations: [
    {
      name: 'the inline mention goes back to a hand-typed URL',
      from: "href={socialProfile('instagram').url}",
      to: "href={'https://www.instagram.com/' + 'hushare_space/'}",
    },
    {
      name: 'the inline mention goes back to a hand-typed handle',
      from: '{socialHandleLabel()}</a>',
      to: '@hushare_space</a>',
    },
  ],
}
