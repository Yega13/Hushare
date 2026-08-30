import type { Tier } from '@/types'

// WHICH PLAN DOES EACH PAID FEATURE NEED? ONE ANSWER, IN ONE PLACE.
//
// Before this file, that fact was written down in four places with three mechanisms:
//
//   refuseBelowTier(ownerId, 'studio', 'Bib number search')   six routes
//   if (tier === 'free') return 403                           custom-url, branding
//   if (tier !== 'studio') / albumHasTier(id, 'studio')       collections page, live wall
//   userTier === 'pro' || userTier === 'studio'               OwnerToolbar, for the badges
//
// Nothing connected them. So a plan change meant finding all four by memory, and the failure when
// you missed one was silent and one-sided: the server refused and the client showed an ordinary
// switch. That is exactly what happened to "remove Hushare branding" — a free owner saw a normal
// toggle, flipped it, and learned it was a paid feature from the error that came back. Same shape
// for the album logo and the sponsor marks, which had no badge at all.
//
// This table is what each feature ACTUALLY requires today — read off the enforcement sites, not
// off the pricing page. tests/plan-gates.test.ts holds every one of those sites against it, so a
// change here fails loudly at whichever place has not followed rather than drifting quietly.
//
// Changing a price or repackaging a plan starts by editing this table and running the tests.

export type PaidFeature =
  | 'customUrl'        // hushare.space/anna-and-david instead of a random slug
  | 'hideBranding'     // remove the Hushare mark from the album
  | 'albumLogo'        // the owner's own logo on the album
  | 'countdownReveal'  // album stays sealed until a date
  | 'photoModeration'  // photos need approval before guests see them
  | 'collections'      // the public /c/<slug> collection page
  | 'liveWall'         // the always-on /wall/<slug> display
  | 'faceFinder'       // find-my-photos by selfie
  | 'bibSearch'        // race-number search
  | 'sponsorLogos'     // sponsor marks on the album

/**
 * The MINIMUM tier each feature needs. 'pro' means Pro or Max; 'studio' means Max only.
 *
 * Read off the code that enforces it, so this describes what the product does rather than what it
 * says. Where the two disagree the pricing page is wrong, not this file.
 */
export const FEATURE_TIER: Record<PaidFeature, Exclude<Tier, 'free'>> = {
  customUrl: 'pro',
  hideBranding: 'pro',
  albumLogo: 'pro',
  countdownReveal: 'pro',
  photoModeration: 'pro',
  collections: 'studio',
  liveWall: 'studio',
  faceFinder: 'studio',
  bibSearch: 'studio',
  sponsorLogos: 'studio',
}

const RANK: Record<Tier, number> = { free: 0, pro: 1, studio: 2 }

/**
 * May this tier use this feature?
 *
 * `null` means the tier is not known YET — a lookup still in flight — and the answer is false
 * without being a refusal. The distinction matters on screen: a control whose tier is unknown must
 * render plain rather than locked, or the owner watches a PRO badge appear on something they paid
 * for and then vanish. See `tierIsKnown`.
 */
export function tierAllows(tier: Tier | null | undefined, feature: PaidFeature): boolean {
  if (!tier) return false
  return RANK[tier] >= RANK[FEATURE_TIER[feature]]
}

/** Has the owner's tier actually been resolved? Only then is it honest to show a lock. */
export function tierIsKnown(tier: Tier | null | undefined): tier is Tier {
  return tier !== null && tier !== undefined
}

/**
 * Should this control be shown as LOCKED — dimmed, with a plan badge?
 *
 * Locked is not simply "not allowed": while the tier is unknown the control stays plain and inert.
 * Inert-and-plain for a few hundred milliseconds is invisible; a badge that contradicts what
 * someone paid for is not.
 */
export function showsAsLocked(tier: Tier | null | undefined, feature: PaidFeature): boolean {
  return tierIsKnown(tier) && !tierAllows(tier, feature)
}
