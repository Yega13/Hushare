// Mutations for /about's "find us" buttons.
//
// Extracted from the page so they can be rendered. The first one below passed the old source-text
// check, because the text it looked for survived the mistake -- which is why they were extracted.
export default {
  file: 'src/components/SocialButtons.tsx',
  test: 'tests/social-buttons.test.tsx',
  mutations: [
    {
      name: 'every button links the first network, so TikTok opens Instagram',
      from: 'href={profile.url}',
      to: 'href={SOCIAL_PROFILES[0].url}',
    },
    {
      name: 'the network name leaves the accessible label, so both buttons announce the same handle',
      from: 'aria-label={`${profile.name} ${handle}`}',
      to: 'aria-label={handle}',
    },
    {
      name: 'every button draws the Instagram mark',
      from: '<SocialGlyph network={profile.network} />',
      to: '<SocialGlyph network="instagram" />',
    },
    {
      name: 'the opened network is told which Hushare page the visitor came from',
      from: 'rel="noopener noreferrer"',
      to: 'rel="noopener"',
    },
  ],
}
