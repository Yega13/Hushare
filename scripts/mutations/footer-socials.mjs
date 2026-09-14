// Mutations for the two prints in the footer.
//
// The look is CSS and is not what these protect. They protect the promises the markup makes: every
// account is reachable, the two links are distinguishable though they share a handle, the opened
// network gets no handle on our page, and the handle survives a translating browser.
export default {
  file: 'src/components/FooterSocials.tsx',
  test: 'tests/footer-socials.test.tsx',
  mutations: [
    {
      name: 'only the first account is rendered',
      from: 'SOCIAL_PROFILES.map((profile) => (',
      to: 'SOCIAL_PROFILES.slice(0, 1).map((profile) => (',
    },
    {
      name: 'both links are named by the handle alone, so a screen reader cannot tell them apart',
      from: 'aria-label={`${profile.name} ${handle}`}',
      to: 'aria-label={handle}',
    },
    {
      name: 'the opened network is told which Hushare page the visitor came from',
      from: 'rel="noopener noreferrer"',
      to: 'rel="noopener"',
    },
    {
      name: 'the network replaces the Hushare page instead of opening beside it',
      from: 'target="_blank"',
      to: 'target="_self"',
    },
    {
      name: 'the handle relies on the page-wide translate attribute alone, and breaks outside that layout',
      from: 'className="hush-foot-handle" translate="no"',
      to: 'className="hush-foot-handle" translate="yes"',
    },
    {
      name: 'the sentence loses its ending',
      from: '{followPost}',
      to: '{null}',
    },
  ],
}
