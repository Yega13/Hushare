// THE RETIREMENT CLOCK, IN ONE PLACE, because its two halves are a safety interlock.
//
// retire-albums deletes a free album only after WARN_BEFORE_DAYS have passed since notify-expiry
// warned its owner. notify-expiry decides when to warn by computing RETIRE_AFTER_DAYS minus
// WARN_BEFORE_DAYS. Each cron carried its own copy of both numbers with a "must mirror" comment —
// and a comment is not a mechanism. Drift one way and warnings stop arriving early enough, so
// albums quietly stop being deletable and storage accumulates forever. Drift the other way and the
// 30 days' notice the privacy policy promises shrinks without anyone deciding it should.
//
// The published copy depends on these too: the privacy policy, the site JSON-LD, the homepage FAQ
// and the support bot all say "1 year of inactivity" with "30 days' warning". If either number
// changes, grep for those phrases and change them in the same commit.

/** How long a FREE album may sit inactive before it is eligible for retirement. */
export const RETIRE_AFTER_DAYS = 365

/** How long before deletion the owner must have been warned. The interlock's other half. */
export const WARN_BEFORE_DAYS = 30

/** Inactivity age at which the warning goes out — derived, never written down separately. */
export const WARN_AFTER_DAYS = RETIRE_AFTER_DAYS - WARN_BEFORE_DAYS
