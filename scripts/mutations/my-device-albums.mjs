// Mutation set for src/components/MyDeviceAlbums.tsx -- run with: node scripts/mutations/run.mjs my-device-albums
export default {
  file: 'src/components/MyDeviceAlbums.tsx',
  test: 'tests/my-device-albums.test.tsx tests/marketing-bundle.test.ts',
  mutations: [
    { name: 'THE LIST RENDERS BEFORE IT KNOWS who is signed in, captioned as if it did',
      from: "  const loggedIn = status === 'loading' ? null : status === 'signed-in'",
      to: "  const loggedIn = status === 'signed-in'" },
    { name: 'a signed-in visitor is treated as signed out, and shown albums already on their account',
      from: "  const loggedIn = status === 'loading' ? null : status === 'signed-in'",
      to: "  const loggedIn = status === 'loading' ? null : false" },
    { name: 'a signed-out visitor is treated as signed in, and offered to attach albums to no account',
      from: "  const loggedIn = status === 'loading' ? null : status === 'signed-in'",
      to: "  const loggedIn = status === 'loading' ? null : true" },
    { name: 'THE SUPABASE CLIENT IS BACK ON THE HOME PAGE',
      from: "import { useAccountIdentity } from '@/lib/use-account-identity'\n",
      to: "import { useAccountIdentity } from '@/lib/use-account-identity'\nimport { createClient } from '@/lib/supabase/client'\n" },
  ],
}
