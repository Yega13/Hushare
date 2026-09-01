// WHEN TO REMIND A PACKAGE OWNER THAT THEIR ALBUM'S TIME IS RUNNING OUT.
//
// The promise on the pricing board: warned at 30 days and again at 7, never deleted silently.
// Renewals are one-time payments from a link in these emails — there is no stored card and
// nothing renews by itself, so THE EMAIL IS THE RENEWAL MECHANISM, not a courtesy. Missing it
// is losing the sale and, later, the album.
//
// Two reminders, not a drumbeat: the 30-day one while there is time to think, the 7-day one for
// everyone who put it off. Each window sends at most once, tracked by package_reminder_at —
// a reminder stamped inside a window covers that window and nothing after it, so entering the
// final week always produces the second email even though the first was already sent.

export const RENEWAL_WARN_FIRST_DAYS = 30
export const RENEWAL_WARN_FINAL_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export type ReminderKind = 'first' | 'final'

/**
 * Which reminder, if any, this album is owed right now.
 *
 * Derived entirely from stored timestamps against `now` — never from the difference of two
 * wall-clock readings, so a clock jump cannot defer it (rule 22). An unreadable remindedAt is
 * treated as "never reminded": the worst case of that direction is a duplicate email, while the
 * other direction skips the only warning between a customer and losing their album.
 */
export function renewalReminderDue(
  expiresAt: Date,
  remindedAt: Date | null,
  now: Date,
): ReminderKind | null {
  const expires = expiresAt.getTime()
  if (!Number.isFinite(expires)) return null      // no expiry, nothing to warn about
  if (expires <= now.getTime()) return null       // lapsed — the retirement machinery owns it now

  // An unreadable stamp yields NaN, and every NaN comparison below is false — so garbage reads
  // as "never reminded" with no extra guard. Worst case of that direction is a duplicate email;
  // the other direction would skip the only warning between a customer and losing their album.
  // (An explicit isFinite check here was removed as dead code: it could not be distinguished from
  // this by any test, which is what rule 16 flags an untestable branch as.)
  const reminded = remindedAt ? remindedAt.getTime() : null
  const finalStart = expires - RENEWAL_WARN_FINAL_DAYS * DAY_MS
  const firstStart = expires - RENEWAL_WARN_FIRST_DAYS * DAY_MS

  if (now.getTime() >= finalStart) {
    return reminded !== null && reminded >= finalStart ? null : 'final'
  }
  if (now.getTime() >= firstStart) {
    return reminded !== null && reminded >= firstStart ? null : 'first'
  }
  return null
}

/** Whole days until expiry, for the email — never less than 1 while unexpired. */
export function daysUntil(expiresAt: Date, now: Date): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS))
}

export type RenewableAlbum = {
  id: string
  slug: string
  custom_slug: string | null
  title: string | null
  package_tier: 'pro' | 'studio' | null
  package_expires_at: string | null
}

/** One album's renewal state, as the account page shows it. */
export type RenewalNotice = {
  album: RenewableAlbum
  tier: 'pro' | 'studio'
  /** Days remaining, or 0 once it has lapsed. */
  daysLeft: number
  lapsed: boolean
}

/**
 * Which of an account's albums to offer a renewal for, soonest first.
 *
 * WHY THIS EXISTS ON THE ACCOUNT PAGE AT ALL: the renewal email used to point at the album, and an
 * album can be behind a password or a reveal date — so the one person who must reach the renew
 * button, two years later on a phone, met a password prompt instead. Weddings, the retention
 * product's core case, are exactly the albums with passwords. The account page can never be gated
 * that way: whoever is signed in owns these rows.
 *
 * A LAPSED package is still listed. Time is added from today rather than from the old expiry, so a
 * late renewal is a real sale and the album is still there to save until the retirement sweep
 * takes it.
 */
export function renewalNotices(albums: RenewableAlbum[], now: Date): RenewalNotice[] {
  const horizon = now.getTime() + RENEWAL_WARN_FIRST_DAYS * DAY_MS
  const out: RenewalNotice[] = []
  for (const album of albums) {
    if (!album.package_tier || !album.package_expires_at) continue
    const expires = new Date(album.package_expires_at).getTime()
    // An unreadable expiry is NOT offered: the amount of time being bought is the one thing this
    // card states, and inventing it is worse than staying quiet (rule 20).
    if (!Number.isFinite(expires)) continue
    if (expires > horizon) continue
    const lapsed = expires <= now.getTime()
    out.push({
      album,
      tier: album.package_tier,
      daysLeft: lapsed ? 0 : daysUntil(new Date(expires), now),
      lapsed,
    })
  }
  return out.sort((a, b) => {
    const at = new Date(a.album.package_expires_at as string).getTime()
    const bt = new Date(b.album.package_expires_at as string).getTime()
    return at - bt
  })
}
