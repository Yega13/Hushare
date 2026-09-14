// Mutations for lib/social-profiles -- the one place Hushare's accounts are written.
//
// The handle was typed three times and the copies had already drifted. Every mutation below is a way
// the single definition could quietly send a visitor, or Google, somewhere wrong.
export default {
  file: 'src/lib/social-profiles.ts',
  test: 'tests/social-profiles.test.ts',
  mutations: [
    {
      name: 'Instagram points at a host that is not Instagram',
      from: 'https://www.instagram.com/',
      to: 'https://instagram.example/',
    },
    {
      name: 'TikTok is linked over plain http',
      from: 'https://www.tiktok.com/@',
      to: 'http://www.tiktok.com/@',
    },
    {
      name: 'a network drops out of the list, so every surface shows one fewer account',
      from: 'Object.freeze([BY_NETWORK.instagram, BY_NETWORK.tiktok])',
      to: 'Object.freeze([BY_NETWORK.instagram])',
    },
    {
      name: 'the list is left mutable, so one importer can change every surface at once',
      from: '= Object.freeze([BY_NETWORK.instagram, BY_NETWORK.tiktok])',
      to: '= [BY_NETWORK.instagram, BY_NETWORK.tiktok]',
    },
    {
      name: 'a profile object is left mutable',
      from: 'instagram: Object.freeze({',
      to: 'instagram: ({',
    },
    {
      name: 'the handle loses its @ where people read it',
      from: 'return `@${SOCIAL_HANDLE}`',
      to: 'return `${SOCIAL_HANDLE}`',
    },
    {
      name: 'the structured data declares fewer accounts than the site links',
      from: 'return SOCIAL_PROFILES.map((p) => p.url)',
      to: 'return SOCIAL_PROFILES.slice(1).map((p) => p.url)',
    },
    {
      name: 'a lookup answers with the wrong network',
      from: 'return BY_NETWORK[network]',
      to: 'return BY_NETWORK.instagram',
    },
    {
      name: 'the Instagram profile is named TikTok, so a screen reader announces the wrong network',
      from: "name: 'Instagram'",
      to: "name: 'TikTok'",
    },
  ],
}
