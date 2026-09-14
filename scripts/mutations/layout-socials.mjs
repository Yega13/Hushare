// Mutations for the structured data the root layout gives Google.
//
// sameAs is how search engines learn these accounts are this site. Narrowing it drops a network from
// the brand's identity without any visible change on any page.
export default {
  file: 'src/app/layout.tsx',
  test: 'tests/social-profiles.test.ts',
  mutations: [
    {
      name: 'the structured data declares only the first account',
      from: 'sameAs: socialProfileUrls(),',
      to: 'sameAs: socialProfileUrls().slice(0, 1),',
    },
  ],
}
