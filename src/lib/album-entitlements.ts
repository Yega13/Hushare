import type { Tier } from '@/types'
import {
  ANON_ALBUM_MEDIA, LEGACY_FREE_ALBUM_MEDIA, GRANDFATHER_FREE_BEFORE, albumMediaCapForTier,
} from '@/lib/media'

// HOW MANY ITEMS MAY THIS ALBUM HOLD? ONE ANSWER, IN ONE PLACE.
//
// Before this file the question had THREE answers that disagreed:
//
//   image-upload-authorization  override ?? albumMediaCapForTier(tier)   no grandfathering at all
//   photos/create, first branch created_at < 2026-08-02 -> hard 1000     ignores the owner's plan
//   photos/create, later branch albumMediaCapForAlbum(tier, created_at)  grandfathers at 2026-08-25
//
// Two different cutoff dates, and because the 2026-08-02 branch was tested FIRST it shadowed the
// tier entirely: an album created before that date was capped at 1,000 no matter what its owner
// paid. A Max customer would have been stopped at a tenth of their allowance. Nobody hit it only
// because all sixteen such albums happen to belong to nobody or to a free account.
//
// It also made the product lie. At 1,000 the shadowing branch returns "Register on Hushare to get
// more space" — but registering leads back into the same branch, so the space does not arrive. A
// message that tells someone to do something useless is worse than no message; see `capReason`,
// which exists so callers can only say "register for more" when it is actually true.
//
// GRANDFATHERING ONLY EVER ADDS, NEVER SUBTRACTS. That is the rule that resolves the collision:
// an old album keeps whatever generous allowance it was promised, and a paid plan is never
// lowered to meet it. Both dates are preserved deliberately rather than merged, because each one
// was a real promise to a real set of albums and picking one would quietly break the other.
//
// WHERE THE PURCHASED-ALBUM PLAN GOES: when an album can be bought outright, it arrives as one
// more candidate in `candidates` below, alongside the tier and the legacy allowances — same
// max() rule, so a purchase can only ever raise the ceiling. Nothing else in the file changes.

/**
 * Albums created before this were promised a 1,000-item ceiling while per-tier caps were rolled
 * out, regardless of whether anyone owned them. Kept as its own date rather than folded into
 * GRANDFATHER_FREE_BEFORE: they were two separate promises to two different sets of albums.
 * tests/album-entitlements.test.ts pins both dates exactly — a cutoff that drifts by a week
 * silently changes what a week of albums was promised, and nothing else would notice.
 */
export const LEGACY_ALL_BEFORE = Date.parse('2026-08-02T00:00:00Z')

export type AlbumCapInput = {
  /** The owner's plan, or null when the album has no account behind it. */
  ownerTier: Tier | null
  /** albums.created_at. Drives both grandfathering dates. */
  createdAt: string | null | undefined
  /** albums.media_cap_override — a deliberate per-album ceiling for partner and event albums. */
  override: number | null | undefined
}

export type CapReason =
  | 'override'      // a per-album ceiling was set by hand; no upsell is appropriate
  | 'legacy'        // the album is grandfathered above what its plan gives today
  | 'plan'          // the owner's plan decides it
  | 'anon'          // no account behind the album — registering genuinely gives more

/** Hard ceiling on media_cap_override, so a typo can never create an unbounded-cost album. */
export const MAX_MEDIA_CAP_OVERRIDE = 200_000

/**
 * The cap for ONE PARTICULAR album, and WHY — the reason is what lets a caller phrase an honest
 * message instead of promising space that will not arrive.
 */
export function albumCap({ ownerTier, createdAt, override }: AlbumCapInput): { cap: number; reason: CapReason } {
  // An override is a deliberate decision about this one album and outranks everything, including
  // the plan. Clamped, because the only way it gets set is by hand.
  if (typeof override === 'number' && override > 0) {
    return { cap: Math.min(override, MAX_MEDIA_CAP_OVERRIDE), reason: 'override' }
  }

  // What the album gets on its own merits today.
  const base = ownerTier ? albumMediaCapForTier(ownerTier) : ANON_ALBUM_MEDIA

  const created = createdAt ? Date.parse(createdAt) : NaN
  // An unreadable date grandfathers. created_at is NOT NULL so this should be unreachable, but the
  // two ways of being wrong are not equal: room an album should not have costs a little storage,
  // while wrongly shrinking one takes space away from something a person already built (rule 19).
  const dateUnknown = !Number.isFinite(created)

  // The two promises, each still scoped to exactly who it was made to.
  //
  //   ANY album created before 2026-08-02 was promised a generous 1,000 ceiling while the new
  //   per-tier caps were introduced — anonymous ones included.
  //
  //   A REGISTERED FREE album created before 2026-08-25 keeps the old free allowance of 1,000,
  //   which is what GRANDFATHER_FREE_BEFORE was written for.
  const beforeLegacyAll = dateUnknown || created < LEGACY_ALL_BEFORE
  const beforeFreeDrop = dateUnknown || created < GRANDFATHER_FREE_BEFORE
  const legacy = (beforeLegacyAll || (ownerTier === 'free' && beforeFreeDrop))
    ? LEGACY_FREE_ALBUM_MEDIA
    : 0

  // Only ever adds. This is the line that fixes the shadowing: a plan is never lowered to meet a
  // grandfathered ceiling.
  const cap = Math.max(base, legacy)
  if (cap === base) return { cap, reason: ownerTier ? 'plan' : 'anon' }
  return { cap, reason: 'legacy' }
}

/**
 * Would signing up actually give this album more room? The ONLY condition under which a caller
 * may say "register for more space".
 *
 * The old code said it to grandfathered albums at their 1,000 ceiling, where registering led
 * straight back to the same 1,000 and nothing happened.
 */
export function registeringWouldHelp(input: AlbumCapInput): boolean {
  if (input.ownerTier) return false   // already has an account
  // No special case for an override: it outranks every tier inside albumCap, so both sides of
  // this comparison come back as the override and the answer is already false. A guard for it
  // would read as a safety check while doing nothing, which is worse than not being there.
  return albumCap({ ...input, ownerTier: 'free' }).cap > albumCap(input).cap
}

/**
 * Would paying for a higher plan give this album more room? Gates the "upgrade" nudge.
 *
 * FALSE when there is no account, always. A guest album has no plan to upgrade and no billing
 * relationship, so "Upgrade your plan for more space" is an instruction they cannot follow. The
 * first version of this file omitted that check, and a grandfathered guest album at 1,000 items —
 * where registering also gives 1,000, so the register nudge correctly declined — fell straight
 * through to telling a stranger to upgrade a plan they had never heard of.
 */
export function upgradingWouldHelp(input: AlbumCapInput): boolean {
  if (!input.ownerTier) return false
  // As above: an override short-circuits albumCap for every tier, so this is false for override
  // albums without needing to say so.
  return albumCap({ ...input, ownerTier: 'studio' }).cap > albumCap(input).cap
}

/**
 * WHICH NUDGE, IF ANY, A FULL ALBUM HAS EARNED — the single answer, so the server message and the
 * client's banner cannot disagree about it.
 *
 * This lived in the route as a chain of ternaries, and the client separately decided from a bare
 * `code: 'album_full'` that an account was the answer. So a Max owner whose album filled was shown
 * "Your album is full — keep going for free / Create a free account", for an account they were
 * already signed into, above a button that would be refused forever.
 *
 *   'register' no account, and signing up genuinely raises this album's ceiling
 *   'upgrade'  has an account, and a higher plan genuinely raises it
 *   'none'     nothing they can buy changes this number — say nothing rather than something false
 */
export type CapNudge = 'register' | 'upgrade' | 'none'

export function capNudge(input: AlbumCapInput): CapNudge {
  if (registeringWouldHelp(input)) return 'register'
  if (upgradingWouldHelp(input)) return 'upgrade'
  return 'none'
}
