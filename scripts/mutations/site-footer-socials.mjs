// Mutations for how SiteFooter carries the socials.
//
// The one that matters most is the last: the footer must never render on an album. A wedding guest
// is there for the couple's photographs, and "Remove Hushare branding" is something owners pay for.
export default {
  file: 'src/components/SiteFooter.tsx',
  test: 'tests/footer-socials.test.tsx',
  mutations: [
    {
      name: 'the footer stops carrying the socials',
      from: "<FooterSocials followPre={t('about.followPre')} followPost={t('about.followPost')} />",
      to: '{null}',
    },
    {
      name: 'the sentence is built from the wrong translation',
      from: "followPre={t('about.followPre')}",
      to: "followPre={t('footer.tagline')}",
    },
    {
      name: 'the footer, and the accounts with it, render on every route including albums',
      from: "if (!footerRoutes.has(normalizedPathname) && !normalizedPathname.startsWith('/statement/')) return null",
      to: 'if (false) return null',
    },
  ],
}
