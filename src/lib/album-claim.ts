// WHO IS ALLOWED TO ATTACH AN ALBUM TO AN ACCOUNT — decided in exactly one place.
//
// An album made while signed out has no owner row: it belongs to whoever holds the owner link.
// Attaching it to an account later is "claiming" it, and it happens on two different paths that
// must never disagree:
//
//   1. Automatically, in claimAlbumIfNeeded, when a signed-in owner touches an owner-only route.
//   2. Deliberately, from the "Add to my account" button, via POST /api/album/claim.
//
// Path 2 was written second and originally re-decided this on its own, WITHOUT the plan cap —
// which would have made the button a way around the album limit that path 1 enforces. That is the
// duplication this module exists to prevent, so put every new rule here and nowhere else.
//
// The cap check needs a COUNT query, which is worth avoiding when a cheaper rule already settles
// the answer. Rather than splitting the rules across two functions that could drift, callers pass
// `ownedCount: null` first; if the cheap rules do not settle it, the answer is 'needs_count' and
// the caller runs the query and asks again.

export type ClaimOutcome =
  | 'claim'          // Go ahead: unowned album, signed-in viewer, room under their plan.
  | 'not_signed_in'  // Nothing to attach it to. The album still works exactly as it did.
  | 'already_yours'  // Nothing to do; treat as success at the UI.
  | 'owned_by_other' // NEVER take it. See the note below.
  | 'at_cap'         // Their plan is full. The album is left anonymous and keeps working.
  | 'needs_count'    // Ask again with ownedCount filled in.
  | 'not_counted'    // The count query itself failed, so the cap cannot be judged. Never claims.

export type ClaimInput = {
  /** albums.user_id — null means the album was created without an account. */
  albumUserId: string | null
  /** The signed-in viewer, or null. Must come from a server-verified session, never a cookie read. */
  viewerId: string | null
  /** How many live albums the viewer already owns, or null if not counted yet. */
  ownedCount: number | null
  /** albumCountLimitForTier(their tier). */
  cap: number
}

export function decideClaim({ albumUserId, viewerId, ownedCount, cap }: ClaimInput): ClaimOutcome {
  if (!viewerId) return 'not_signed_in'

  // Ownership is checked BEFORE anything else that could be mistaken for permission. Proving you
  // hold the owner link proves you may manage the album; it does not entitle you to take it off
  // the account it already sits on. Erring this way costs a real owner nothing — their album is
  // already on their account — while the other direction hands somebody else's album away.
  if (albumUserId) return albumUserId === viewerId ? 'already_yours' : 'owned_by_other'

  if (ownedCount === null) return 'needs_count'

  // At the cap the album is LEFT ANONYMOUS rather than the request being failed. Nothing is lost:
  // it still opens, still takes photos, and the owner link still works exactly as it did a moment
  // earlier. Claiming is a convenience, not what makes an album function.
  if (ownedCount >= cap) return 'at_cap'

  return 'claim'
}

/** True when the outcome means the album now sits on the viewer's account — including the no-op. */
export function claimSucceeded(outcome: ClaimOutcome): boolean {
  return outcome === 'claim' || outcome === 'already_yours'
}

/** HTTP status for an outcome, so the route and its tests cannot disagree about it. */
export function claimStatus(outcome: ClaimOutcome): number {
  if (claimSucceeded(outcome)) return 200
  if (outcome === 'not_signed_in') return 401
  // A failure on our side, not the caller's — they may legitimately retry.
  if (outcome === 'not_counted') return 503
  // 'needs_count' escaping to a status is a caller bug, not a user error — the caller was meant to
  // run the count and ask again. Say 500 so it is loud rather than mistaken for a real refusal.
  if (outcome === 'needs_count') return 500
  // at_cap and owned_by_other are both 409, not 403: the caller DID prove they hold the owner
  // link, so neither is an authentication failure. Each conflicts with a state that already exists.
  return 409
}
