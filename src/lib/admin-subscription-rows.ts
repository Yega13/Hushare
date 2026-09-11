// WHO IS A CUSTOMER, AND WHO IS US.
//
// This sat inside the admin page, which is why it was wrong for as long as it was: the rule had no
// test, and the two halves of it were written against different columns. A dashboard that counts
// its own gifts as revenue is worse than no dashboard, because every number built on it is wrong
// in the flattering direction -- and it is wrong quietly, which is the part that costs something.
//
// TWO SIGNALS, because either alone misses a real case. A comped row is by definition not revenue
// (see lib/subscription-origin, which owns that test). An admin account is not a customer even
// without one, because computeUserTier resolves admins to Max in code and they may hold no row at
// all.

import { isCompedSubscription } from '@/lib/subscription-origin'

/** Only what the split needs. The page selects more; none of the rest is a factor here. */
export type SubscriptionRow = {
  id?: string | null
  user_id?: string | null
  tier?: string | null
  status?: string | null
  polar_subscription_id?: string | null
  polar_product_id?: string | null
}

/** One line in the "Admins & comped" table. */
export type HouseRow = {
  email: string
  tier: string
  /** Why this account has paid features without paying: "admin", "comped", or both. */
  why: string
  /** Did we give it away? Drives the gift mark -- an admin with no comp row is not a gift. */
  comped: boolean
  /** The row's own primary key, or null when there is no row to remove (an admin holds none). */
  subId: string | null
  status: string
}

export type AdminUser = { id?: string | null; email?: string | null }

/**
 * Split the subscription rows into revenue and everything else.
 *
 * Order is preserved in both halves, so the page's own sort survives.
 */
export function splitSubscriptions(
  subs: readonly SubscriptionRow[],
  emailById: ReadonlyMap<string, string>,
  isAdminEmail: (email: string | null | undefined) => boolean,
): { paying: SubscriptionRow[]; house: SubscriptionRow[] } {
  const paying: SubscriptionRow[] = []
  const house: SubscriptionRow[] = []
  for (const sub of subs) {
    const email = sub.user_id ? emailById.get(sub.user_id) : null
    if (isCompedSubscription(sub) || isAdminEmail(email)) house.push(sub)
    else paying.push(sub)
  }
  return { paying, house }
}

/**
 * The people behind the house rows, one line each.
 *
 * PEOPLE, NOT ROWS. An admin's Max comes from code, so the owner's own account has no subscription
 * row at all -- a row-based section showed "None." while a comped row sat in the revenue table.
 * Admins are listed whether or not they hold a row; a comped non-admin is listed from their row.
 *
 * An admin who ALSO holds a comp is listed once, with both reasons, and carries that row's id so
 * the comp can be removed without touching their admin status -- which lives in an env var and is
 * not this table's business.
 */
export function houseAccountRows(
  houseSubs: readonly SubscriptionRow[],
  allUsers: readonly AdminUser[],
  emailById: ReadonlyMap<string, string>,
  isAdmin: (user: AdminUser) => boolean,
): HouseRow[] {
  const rows: HouseRow[] = []
  const seen = new Set<string>()
  // BY ID AS WELL AS BY EMAIL. Deduping on the email alone listed a comped admin twice whenever
  // emailById could not resolve them: the first pass wrote their real address, the second fell back
  // to "(user)", and the two did not match. The id is the thing that actually identifies a person.
  const seenUsers = new Set<string>()

  for (const user of allUsers) {
    if (!isAdmin(user)) continue
    const email = user.email ?? '(no email)'
    if (seen.has(email)) continue
    seen.add(email)
    if (user.id) seenUsers.add(user.id)
    const comp = houseSubs.find((s) => s.user_id != null && s.user_id === user.id && isCompedSubscription(s))
    rows.push({
      email,
      tier: 'studio',
      why: comp ? 'admin · comped' : 'admin',
      // An admin without a comp row was given nothing -- the tier is what the code grants them.
      // Marking that as a gift would put a present next to our own accounts.
      comped: comp !== undefined,
      subId: comp?.id ?? null,
      status: String(comp?.status ?? ''),
    })
  }

  for (const sub of houseSubs) {
    if (sub.user_id && seenUsers.has(sub.user_id)) continue
    const email = sub.user_id ? (emailById.get(sub.user_id) ?? '(user)') : '—'
    if (seen.has(email)) continue
    seen.add(email)
    if (sub.user_id) seenUsers.add(sub.user_id)
    rows.push({
      email,
      tier: String(sub.tier ?? ''),
      why: 'comped',
      comped: isCompedSubscription(sub),
      subId: sub.id ?? null,
      status: String(sub.status ?? ''),
    })
  }

  return rows
}
