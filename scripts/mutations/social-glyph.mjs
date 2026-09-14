// Mutations for the two network marks.
//
// Swapping which branch draws which put the TikTok mark on every Instagram link site-wide, and every
// test passed: they counted the marks and checked they were decorative, and never looked at which
// mark was drawn. A review found it.
export default {
  file: 'src/components/SocialGlyph.tsx',
  test: 'tests/footer-socials.test.tsx',
  mutations: [
    {
      name: 'the marks are swapped, so Instagram links show TikTok and the reverse',
      from: "if (network === 'instagram') {",
      to: "if (network === 'tiktok') {",
    },
    {
      name: 'the Instagram mark loses its outline',
      from: '<rect width="20" height="20" x="2" y="2" rx="5" ry="5" />',
      to: '',
    },
  ],
}
