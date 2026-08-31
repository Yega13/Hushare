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

// ── HOW MUCH VIDEO MAY THIS ALBUM HOLD ───────────────────────────────────────────
//
// Until this shipped there was NO limit on video at all — not on how long a clip could be, not on
// how many an album could hold. The only video control in the code was per-file SIZE. So one Pro
// album could legally hold 3,000 clips of ten minutes each: 30,000 stored minutes, about $150 a
// month, against a $4 plan. Nothing came close only because the average clip people actually
// upload is 14.5 seconds.
//
// Two numbers, not a pooled budget. "Clips up to 2 minutes, up to 30 videos" is something a guest
// can hold in their head at the moment they are refused; "300 pooled minutes remaining" is not.
//
// WHY VIDEO GETS ITS OWN LIMITS AT ALL, when photos share one allowance: Cloudflare Stream bills
// per MINUTE STORED, every month, plus again per minute watched — while R2 bills per byte and
// charges nothing for delivery. Measured on this library, one minute of video costs the same as
// 300 photos per year. An item cap alone therefore does not bound cost, because a video item is
// ~300x a photo item.

export type VideoCaps = {
  /** Longest single clip, in seconds. Enforced by Cloudflare at upload, not just in the UI. */
  maxClipSeconds: number
  /** How many videos this album may hold in total. */
  maxVideos: number
}

// 60 seconds, not 30. Measured against every video on the platform: the longest clip any free
// album has ever held is 54s, the median is 13s and the 90th percentile is 33s. A 30-second cap
// would have refused 13% of real free uploads and 19% at 20 seconds — to save money that is not
// there. At 2,900 free albums, today's actual behaviour costs about $6/month; even a tenfold
// increase is $57. The COUNT is what bounds this, not the length.
const FREE_VIDEO_CAPS: VideoCaps = { maxClipSeconds: 60, maxVideos: 20 }
const PRO_VIDEO_CAPS: VideoCaps = { maxClipSeconds: 120, maxVideos: 30 }
const STUDIO_VIDEO_CAPS: VideoCaps = { maxClipSeconds: 600, maxVideos: 40 }

/**
 * Video limits for one album.
 *
 * An album with no account behind it gets the free limits rather than something tighter: its 250
 * ITEM cap already stops it long before video cost becomes interesting, and a guest album is the
 * first thing anybody tries — making it meaner than free buys nothing and teaches the wrong
 * lesson about the product.
 */
export function videoCaps(ownerTier: Tier | null | undefined): VideoCaps {
  if (ownerTier === 'studio') return STUDIO_VIDEO_CAPS
  if (ownerTier === 'pro') return PRO_VIDEO_CAPS
  return FREE_VIDEO_CAPS
}

/** Is this clip short enough for the album? `null` duration means we could not measure it. */
export function clipTooLong(seconds: unknown, caps: VideoCaps): boolean {
  // `unknown`, not `number`, because the only caller gets this straight off a request body. Typing
  // it as a number would move the lie one layer up rather than removing it.
  // An unmeasurable clip is NOT refused here. The upload path already bounds it separately, and
  // refusing something we could not measure would turn a failed metadata read on someone's phone
  // into "your video is too long", which is both wrong and unfixable by them.
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return false
  // A whole second of slack: browsers report duration as a float and a 30.02s read of a 30s clip
  // is a measurement artefact, not a rule being broken.
  return seconds > caps.maxClipSeconds + 1
}

/** Is the album already holding as many videos as it may? */
export function videoAlbumFull(existingVideos: number, caps: VideoCaps): boolean {
  return existingVideos >= caps.maxVideos
}

/** "2 minutes", "30 seconds" — for a refusal message that names the limit it hit. */
export function formatClipLimit(seconds: number): string {
  if (seconds % 60 === 0) {
    const mins = seconds / 60
    return mins === 1 ? '1 minute' : `${mins} minutes`
  }
  return `${seconds} seconds`
}

// ── THE TWO VIDEO REFUSALS, WRITTEN ONCE ─────────────────────────────────────────────────────
//
// These are DELIBERATE refusals, not failures: the guest is being told a rule, and nothing is
// broken. lib/upload-policy has to recognise them by prefix for two separate reasons, and both
// are unpleasant when it cannot:
//
//   1. An unrecognised refusal is filed at 'error' level, so it lands in the admin Errors tab.
//      A 103 MB video refused twice once accounted for two of the four outstanding "errors" while
//      nothing was wrong. About 11% of recent free-tier videos are over 30 seconds, so this alone
//      would have buried the panel.
//   2. Worse, an unrecognised video failure calls noteVideoOutcome(false), which collapses that
//      guest's video upload lane to serial FOR THE REST OF THE SESSION. One refused clip would
//      have slowed every later video that person uploaded.
//
// So the prefix and the message must be the same fact. They are built here, and upload-policy
// imports the prefixes rather than retyping them.
export const VIDEO_TOO_LONG_PREFIX = 'Videos in this album can be up to'
export const VIDEO_ALBUM_FULL_PREFIX = 'This album is full of videos'

export function videoTooLongMessage(caps: VideoCaps): string {
  return `${VIDEO_TOO_LONG_PREFIX} ${formatClipLimit(caps.maxClipSeconds)} long. `
    + 'Trim it shorter in your phone, then try again.'
}

export function videoAlbumFullMessage(caps: VideoCaps): string {
  return `${VIDEO_ALBUM_FULL_PREFIX} — it holds ${caps.maxVideos}. Photos can still be added.`
}
