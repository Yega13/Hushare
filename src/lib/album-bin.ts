/**
 * THE BIN: a deleted album is hidden for seven days before anything is destroyed.
 *
 * WHY IT EXISTS. Deleting an album was immediate and total — the R2 objects, the Stream videos and
 * the row, gone in one request, with no backup anywhere. Anyone holding the owner link could do it,
 * and for an album made without an account the owner link is the ONLY proof of ownership, so
 * "anyone you shared it with" includes people you only meant to help you manage it. There was no
 * undo, and the thing destroyed is somebody's wedding.
 *
 * WHAT THE BIN CHANGES. Deleting now marks the album instead of destroying it. It disappears
 * immediately and completely — the link stops working for everyone, exactly as before — but the
 * files stay where they are, and for seven days the owner can put it back. After that a cron does
 * the real deletion.
 *
 * WHY MARKING IT ALSO MARKS IT RETIRED. There are 86 places in this codebase that read the albums
 * table. Auditing every one of them to add a new filter is precisely how one gets missed, and a
 * missed one means an album the owner believes is deleted is still being served. `retired_at` is
 * already filtered at SQL level by the guest resolver and by every owner mutation, so setting it
 * makes a binned album invisible through paths that already exist and are already tested. The new
 * column records WHY and WHEN; the old one does the hiding.
 *
 * WHICH WAY EVERY DECISION HERE ERRS. Toward keeping data. A bin that fails to purge costs
 * $0.015 per GB per month. A bin that purges early destroys a wedding, and there is no backup
 * (rule 19). So: an unreadable or absurd timestamp is NOT purgeable, and a clock that has moved
 * backwards is NOT a reason to delete anything.
 */

/** How long a deleted album can be recovered. The owner-facing promise. */
export const BIN_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export type BinState =
  /** Not deleted. */
  | { state: 'live' }
  /** Deleted, still recoverable. */
  | { state: 'in-bin'; daysLeft: number }
  /** Deleted and past the window: the purge may destroy it. */
  | { state: 'purgeable' }
  /** Marked deleted, but the timestamp makes no sense. Hidden, and NEVER purged automatically. */
  | { state: 'unreadable' }

/**
 * What may be done with this album right now.
 *
 * `nowMs` is passed in rather than read here so the caller owns the clock and every branch is
 * reachable from a test.
 */
export function binState(deletedAt: string | null | undefined, nowMs: number): BinState {
  if (deletedAt === null || deletedAt === undefined || deletedAt === '') return { state: 'live' }

  const then = Date.parse(deletedAt)
  if (!Number.isFinite(then)) return { state: 'unreadable' }

  const elapsed = nowMs - then

  // DELETED IN THE FUTURE. A clock correction, a timezone bug, or a bad write. It is not evidence
  // that seven days have passed, and treating it as such would purge immediately — the one outcome
  // that cannot be undone (rule 22).
  if (elapsed < 0) return { state: 'in-bin', daysLeft: BIN_DAYS }

  // ABSURDLY OLD. A year in the bin means something is wrong with the timestamp or with the cron,
  // and neither is a reason for an automatic irreversible delete. Hidden, kept, and left for a
  // human — the storage cost of being wrong here is cents.
  if (elapsed > 365 * DAY_MS) return { state: 'unreadable' }

  if (elapsed >= BIN_DAYS * DAY_MS) return { state: 'purgeable' }

  // Rounded UP, so "1 day left" never means "gone in an hour". The owner is told the pessimistic
  // number for us and the optimistic one for them.
  return { state: 'in-bin', daysLeft: Math.max(1, Math.ceil((BIN_DAYS * DAY_MS - elapsed) / DAY_MS)) }
}

/** May the owner put this album back? */
export function canRestore(deletedAt: string | null | undefined, nowMs: number): boolean {
  const s = binState(deletedAt, nowMs)
  // 'unreadable' included on purpose: the album still EXISTS and nothing has been destroyed, so
  // refusing to restore it would strand real data over a bad timestamp.
  return s.state === 'in-bin' || s.state === 'unreadable'
}

/** May the purge cron destroy this album's files and row? Only ever this one state. */
export function isPurgeable(deletedAt: string | null | undefined, nowMs: number): boolean {
  return binState(deletedAt, nowMs).state === 'purgeable'
}

/** What the owner is told after deleting. */
export function binMessage(daysLeft: number): string {
  return daysLeft === 1
    ? 'Album deleted. You can restore it for 1 more day.'
    : `Album deleted. You can restore it for ${daysLeft} more days.`
}
