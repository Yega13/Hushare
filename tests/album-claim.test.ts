import { describe, it, expect } from 'vitest'
import {
  decideClaim, claimSucceeded, claimStatus, type ClaimInput, type ClaimOutcome,
} from '../src/lib/album-claim'

const ME = 'b56744cd-a42a-4005-a2dd-cdff21e86490'
const SOMEONE_ELSE = '00000000-1111-2222-3333-444444444444'

const input = (over: Partial<ClaimInput> = {}): ClaimInput => ({
  albumUserId: null, viewerId: ME, ownedCount: 0, cap: 3, ...over,
})

describe('decideClaim', () => {
  it('NEVER takes an album that already belongs to somebody else', () => {
    // The whole safety property. Holding the owner link proves you may manage the album; it does
    // not entitle you to move it off the account it sits on. Without this, knowing a slug and
    // holding a link would be a way to take another person's album.
    expect(decideClaim(input({ albumUserId: SOMEONE_ELSE }))).toBe('owned_by_other')
  })

  it('refuses to take somebody else even when the viewer has masses of room', () => {
    // Ownership must be checked BEFORE the cap, or a generous plan reads as permission.
    expect(decideClaim(input({ albumUserId: SOMEONE_ELSE, ownedCount: 0, cap: 50 }))).toBe('owned_by_other')
  })

  it('attaches an unowned album to a signed-in viewer with room', () => {
    expect(decideClaim(input({ albumUserId: null, ownedCount: 2, cap: 3 }))).toBe('claim')
  })

  it("is a no-op, not an error, when it is already the viewer's", () => {
    // A second tap, another tab, or the automatic path having just done it. The button must not
    // show a failure for a state the person asked for and now has.
    const outcome = decideClaim(input({ albumUserId: ME }))
    expect(outcome).toBe('already_yours')
    expect(claimSucceeded(outcome)).toBe(true)
  })

  it('refuses without a session, because there is no account to attach it to', () => {
    expect(decideClaim(input({ viewerId: null }))).toBe('not_signed_in')
    expect(decideClaim(input({ viewerId: null, albumUserId: SOMEONE_ELSE }))).toBe('not_signed_in')
  })

  it('stops at the plan cap — this route is not a way around the album limit', () => {
    // api/album/create enforces the cap only on requests that ARRIVE authenticated. Without this
    // check, making albums signed-out and claiming them afterwards would put any number on a free
    // account.
    expect(decideClaim(input({ ownedCount: 3, cap: 3 }))).toBe('at_cap')
    expect(decideClaim(input({ ownedCount: 9, cap: 3 }))).toBe('at_cap')
  })

  it('allows the very last album under the cap — an off-by-one here costs a real album', () => {
    // Emma owned 2 of 3 when she wrote in. If this boundary were wrong by one, the fix built for
    // her would have refused her.
    expect(decideClaim(input({ ownedCount: 2, cap: 3 }))).toBe('claim')
  })

  it('the cap=0 probe both callers use must NOT read as at_cap', () => {
    // claimAlbumIfNeeded and the route both open with { ownedCount: null, cap: 0 } to ask the
    // cheap questions before paying for a COUNT. If the cap check ever moved above the
    // ownedCount check, that sentinel would answer 'at_cap' for everyone — 0 >= 0 — and no album
    // would ever be claimed again, silently.
    expect(decideClaim({ albumUserId: null, viewerId: ME, ownedCount: null, cap: 0 })).toBe('needs_count')
  })

  it('asks for a count only when a count could still change the answer', () => {
    // The count is a COUNT query on albums. Rules that settle it for free must run first.
    expect(decideClaim(input({ ownedCount: null }))).toBe('needs_count')
    expect(decideClaim(input({ ownedCount: null, viewerId: null }))).toBe('not_signed_in')
    expect(decideClaim(input({ ownedCount: null, albumUserId: ME }))).toBe('already_yours')
    expect(decideClaim(input({ ownedCount: null, albumUserId: SOMEONE_ELSE }))).toBe('owned_by_other')
  })
})

describe('claimSucceeded', () => {
  it('counts only the two outcomes where the album ends up on the account', () => {
    expect(claimSucceeded('claim')).toBe(true)
    expect(claimSucceeded('already_yours')).toBe(true)
    for (const bad of ['not_signed_in', 'owned_by_other', 'at_cap', 'needs_count'] as const) {
      expect(claimSucceeded(bad), bad).toBe(false)
    }
  })
})

describe('claimStatus', () => {
  it('does not call a refusal a success, or a success a refusal', () => {
    expect(claimStatus('claim')).toBe(200)
    expect(claimStatus('already_yours')).toBe(200)
    expect(claimStatus('not_signed_in')).toBe(401)
    expect(claimStatus('at_cap')).toBe(409)
    expect(claimStatus('owned_by_other')).toBe(409)
  })

  it('is loud about needs_count, which is a caller bug rather than a user error', () => {
    // Reaching a status with needs_count means the caller skipped the count and asked anyway.
    // A 4xx would read as a legitimate refusal and hide the mistake.
    expect(claimStatus('needs_count')).toBe(500)
  })

  it('has a status for EVERY outcome, so a new one cannot default to 409 in silence', () => {
    // claimStatus ends in a bare `return 409`. A future outcome added to the union would fall
    // into it and be reported as a conflict — a plausible-looking wrong answer, which is worse
    // than a loud one. This fails the moment someone adds an outcome without deciding its status.
    const all: ClaimOutcome[] = [
      'claim', 'already_yours', 'not_signed_in', 'owned_by_other', 'at_cap', 'needs_count', 'not_counted',
    ]
    const known: Record<ClaimOutcome, number> = {
      claim: 200, already_yours: 200, not_signed_in: 401,
      owned_by_other: 409, at_cap: 409, needs_count: 500, not_counted: 503,
    }
    expect(all.sort()).toEqual((Object.keys(known) as ClaimOutcome[]).sort())
    for (const o of all) expect(claimStatus(o), o).toBe(known[o])
  })

  it('a count we could not take is a retryable failure, never a refusal', () => {
    // 503, not 409: nothing about the request was wrong, and the caller may legitimately retry.
    expect(claimStatus('not_counted')).toBe(503)
    expect(claimSucceeded('not_counted')).toBe(false)
  })
})
