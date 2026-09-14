// WHERE HUSHARE LIVES OUTSIDE HUSHARE.
//
// The handle was typed out three times -- twice on /about, once in the structured data the root
// layout hands to Google -- and the copies had already drifted: /about linked Instagram with a
// trailing slash, the layout without one. Harmless today. The failure it predicts is not: rename the
// account once, miss one copy, and one surface sends visitors to a profile that no longer exists
// while the others look fine. Nothing would ever report it.
//
// Adding the footer would have made it four copies, so the profiles are defined here once and every
// surface reads them. tests/social-profiles.test.ts scans src for the handle and fails on any file
// but this one.
//
// Pure data, no imports: /about is a server component, SiteFooter is a client one, and both read
// this. Anything added here ships to every marketing page's browser bundle.

/** The same handle on every network, which is what lets one line of copy name both. */
export const SOCIAL_HANDLE = 'hushare_space'

export type SocialNetwork = 'instagram' | 'tiktok'

export type SocialProfile = {
  network: SocialNetwork
  /** The network's own name. A proper noun, so it needs no translation in any locale. */
  name: string
  url: string
}

// A RECORD, so a network added to the type without a profile is a compile error rather than a
// footer that silently shows one fewer print.
const BY_NETWORK: Readonly<Record<SocialNetwork, SocialProfile>> = Object.freeze({
  instagram: Object.freeze({ network: 'instagram', name: 'Instagram', url: `https://www.instagram.com/${SOCIAL_HANDLE}/` }),
  tiktok: Object.freeze({ network: 'tiktok', name: 'TikTok', url: `https://www.tiktok.com/@${SOCIAL_HANDLE}` }),
})

/** Every profile, in the order surfaces show them. */
export const SOCIAL_PROFILES: readonly SocialProfile[] = Object.freeze([BY_NETWORK.instagram, BY_NETWORK.tiktok])

/** One network's profile. */
export function socialProfile(network: SocialNetwork): SocialProfile {
  return BY_NETWORK[network]
}

/** The handle as people write it. */
export function socialHandleLabel(): string {
  return `@${SOCIAL_HANDLE}`
}

/** Every profile URL, for schema.org `sameAs` -- the claim that these accounts are this site. */
export function socialProfileUrls(): string[] {
  return SOCIAL_PROFILES.map((p) => p.url)
}
