// DID THEY PAY FOR THIS, OR DID WE GIVE IT TO THEM?
//
// One question, and it was answered in three different places that disagreed:
//
//   - scripts/comp-user-plan.mjs writes polar_product_id = "comp"
//   - the admin comp button writes polar_product_id = "comp-pro" / "comp-studio"
//   - src/app/admin/page.tsx asked polar_product_id.startsWith("comp-")
//
// "comp" does not start with "comp-". So every account comped by the SCRIPT was invisible to the
// dashboard and counted as revenue, while accounts comped by the BUTTON were correctly excluded.
// Measured on the live table when this was written: two of the seven subscription rows -- both of
// the gifts sent out for the 100-user milestone -- were sitting in the paying list.
//
// That is the failure mode the admin page already names in its own comment: "a dashboard that
// counts its own operators as customers is worse than no dashboard, because every number built on
// it is wrong in the flattering direction". It was written about admins and it was true about
// comps the whole time, one column over.
//
// THE SUBSCRIPTION ID IS THE RELIABLE MARKER. Both writers set it, and it is what the comp script
// deletes on (--clear) and what polar-reconcile is deliberately blind to. The product id is checked
// too, because rows already in the table carry the marker there in two different shapes and a
// predicate that only handles the tidy one is how this bug happened in the first place.
//
// ERRS TOWARD "COMPED" (rule 19). Calling revenue a gift understates a number on an internal page.
// Calling a gift revenue means deciding what the business is worth from a figure that includes
// things nobody paid for, which is the direction that actually costs something.

/** The prefix both comp writers use. Bare, because one writer emits exactly this and no suffix. */
export const COMP_PREFIX = 'comp'

export type SubscriptionOrigin = 'comped' | 'paid'

/** Only the two fields the question is answerable from; anything else is the caller's business. */
export type SubscriptionIdentifiers = {
  polar_subscription_id?: string | null
  polar_product_id?: string | null
}

/**
 * Could a real Polar identifier ever look like a comp marker?
 *
 * No, and this is why the bare "comp" prefix is safe rather than reckless. Polar's ids are UUIDs --
 * hex digits and dashes -- and "o", "m" and "p" are not hex digits. No real id can begin "comp".
 */
function marksAComp(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false
  return value.trim().toLowerCase().startsWith(COMP_PREFIX)
}

export function subscriptionOrigin(row: SubscriptionIdentifiers): SubscriptionOrigin {
  if (marksAComp(row.polar_subscription_id)) return 'comped'
  if (marksAComp(row.polar_product_id)) return 'comped'
  return 'paid'
}

/** Did we give this away? */
export function isCompedSubscription(row: SubscriptionIdentifiers): boolean {
  return subscriptionOrigin(row) === 'comped'
}
