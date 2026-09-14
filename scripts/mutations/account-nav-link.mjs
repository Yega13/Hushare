// Mutation set for src/components/AccountNavLink.tsx -- run with: node scripts/mutations/run.mjs account-nav-link
//
// The wiring that makes a sign-in elsewhere show up here, and the one import that must stay out of a
// marketing page. tests/marketing-bundle walks the imports; tests/account-nav-link renders the link.
export default {
  file: 'src/components/AccountNavLink.tsx',
  test: 'tests/account-nav-link.test.tsx tests/marketing-bundle.test.ts',
  mutations: [
    { name: 'another tab signing out is never heard',
      from: "  useEffect(() => watchAuthFromOtherTabs(clearAccountIdentityCache), [])",
      to: "  useEffect(() => watchAuthFromOtherTabs(() => {}), [])" },
    { name: 'the effect drops its cleanup, so an unmounted link keeps a channel open and re-asks',
      from: "  useEffect(() => watchAuthFromOtherTabs(clearAccountIdentityCache), [])",
      to: "  useEffect(() => { watchAuthFromOtherTabs(clearAccountIdentityCache) }, [])" },
    { name: 'THE SUPABASE CLIENT IS BACK ON EVERY MARKETING PAGE',
      from: "import { watchAuthFromOtherTabs } from '@/lib/auth-tab-sync'\n",
      to: "import { watchAuthFromOtherTabs } from '@/lib/auth-tab-sync'\nimport { createClient } from '@/lib/supabase/client'\n" },
  ],
}
