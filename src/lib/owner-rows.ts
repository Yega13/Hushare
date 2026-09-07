import { tierAllows, showsAsLocked, type PaidFeature } from '@/lib/plan-gates'
import type { Tier } from '@/types'

// WHAT EACH ROW OF THE OWNER TOOLBAR LOOKS LIKE, decided in one place.
//
// The toolbar has seven rows whose appearance depends on the plan, and until now each one composed
// its own answer inline from tierAllows(), showsAsLocked(), a live package, and a neighbour's state
// -- four booleans per row, written slightly differently every time, inside a 2,000-line component
// where nothing could ask "what does a free owner on a packaged album see?". This module is that
// question with an answer that can be tested (rule 14).
//
// The output is the three things the render actually uses, not a state name that would have to be
// mapped back into them:
//
//   show     render the row at all
//   dimmed   grey it out with the plan badge doing the explaining (gatedRowStyle's `locked`)
//   enabled  the control responds
//
// Three shapes of "not live" exist and they LOOK different, which is why three booleans:
//   locked   dimmed, disabled -- the plan does not include it; the badge sells the tier above
//   inert    dimmed, disabled -- for a reason that is not the plan: nothing to moderate, or
//            branding held on by a collaboration
//   pending  plain, disabled  -- the tier is still being looked up. A PRO badge appearing on
//            something the owner pays for and then vanishing is worse than a few hundred
//            milliseconds of a control that does nothing.
//
// A LIVE PACKAGE flips the whole toolbar into pure-hide: rows the package does not include are not
// rendered, instead of greyed with an upsell. The owner's rule, verbatim: "in packages don't show
// anything that is unaccessible." They bought a finished product; a product that nags about the
// tier above is noise. Free and subscription albums keep the grey-and-badge upsell.

export type RowLook = { show: boolean; dimmed: boolean; enabled: boolean }

export type OwnerRowsInput = {
  /** The ALBUM's effective tier (package included); null/undefined while still being looked up. */
  tier: Tier | null | undefined
  /** An unexpired package on the album. */
  packagedLive: boolean
  /** Collections gate on the ACCOUNT, not the album; this is the answer the server sent. */
  collectionsEnabled: boolean
  /** Branding held on by a collaboration agreement (lib/album-entitlements). */
  brandingLocked: boolean
  guestUploadsEnabled: boolean
}

export type OwnerRowKey = 'customUrl' | 'moderation' | 'collections' | 'branding' | 'faceFinder' | 'bibSearch' | 'liveWall'
export type OwnerRows = Record<OwnerRowKey, RowLook>

const LIVE: RowLook = { show: true, dimmed: false, enabled: true }
const LOCKED: RowLook = { show: true, dimmed: true, enabled: false }
const INERT: RowLook = { show: true, dimmed: true, enabled: false }
const PENDING: RowLook = { show: true, dimmed: false, enabled: false }
const HIDDEN: RowLook = { show: false, dimmed: true, enabled: false }

/** The ordinary plan-gated row: hidden on a live package, locked otherwise, pending while unknown. */
function planRow(tier: Tier | null | undefined, feature: PaidFeature, packagedLive: boolean): RowLook {
  if (showsAsLocked(tier, feature)) return packagedLive ? HIDDEN : LOCKED
  if (!tierAllows(tier, feature)) return PENDING
  return LIVE
}

export function ownerRows(input: OwnerRowsInput): OwnerRows {
  const { tier, packagedLive } = input

  // APPROVAL ONLY MEANS SOMETHING WHILE GUESTS CAN ADD PHOTOS. With uploads off, nothing can ever
  // arrive to be approved, so the switch would govern an empty set -- it looks live, saves, and
  // changes nothing anybody will see. Greyed instead. Only DISABLED, never switched off: the stored
  // value stays, so turning uploads back on restores the real setting rather than silently
  // publishing the next guest photo straight into a wedding album.
  const moderation = (() => {
    const plan = planRow(tier, 'photoModeration', packagedLive)
    if (plan === HIDDEN || plan === LOCKED) return plan
    if (!input.guestUploadsEnabled) return INERT
    return plan
  })()

  // Branding removal is gated by api/album/branding, and once had NO badge and NO dimming -- a free
  // owner saw an ordinary switch, flipped it, and learned it was paid from the error. A collab lock
  // dims it for a different reason, with different copy, and never hides it.
  const branding = (() => {
    const plan = planRow(tier, 'hideBranding', packagedLive)
    if (plan === HIDDEN || plan === LOCKED) return plan
    if (input.brandingLocked) return INERT
    return plan
  })()

  // Collections have no "pending": the server's boolean is known before render.
  const collections = input.collectionsEnabled ? LIVE : packagedLive ? HIDDEN : LOCKED

  return {
    customUrl: planRow(tier, 'customUrl', packagedLive),
    moderation,
    collections,
    branding,
    faceFinder: planRow(tier, 'faceFinder', packagedLive),
    // Two rows the toolbar renders WITHOUT dimming, and this module says so rather than fixing it
    // quietly: bib search only disables its control, and the live-wall button stays fully usable
    // when locked because the wall page gates itself. Both are recorded here as what the product
    // does today; changing either is a product decision, not a refactor.
    bibSearch: tierAllows(tier, 'bibSearch') ? LIVE : PENDING,
    liveWall: packagedLive && showsAsLocked(tier, 'liveWall') ? HIDDEN : LIVE,
  }
}
