import type { Tier } from '@/types'
import {
  ANON_ALBUM_MEDIA, LEGACY_FREE_ALBUM_MEDIA, GRANDFATHER_FREE_BEFORE, albumMediaCapForTier,
} from '@/lib/media'
import { PACKAGE_CATALOGUE } from '@/lib/package-catalogue'

/** Item allowance per package tier, read from the catalogue so the price list and the enforcement
 *  cannot disagree about what somebody bought. */
const PACKAGE_ITEMS_BY_TIER: Record<Exclude<Tier, 'free'>, number> = {
  pro: PACKAGE_CATALOGUE.package_pro.items,
  studio: PACKAGE_CATALOGUE.package_max.items,
}

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
  /** A one-off package bought for THIS album, if any. Its item allowance is its own number, not
   *  its tier's: a Pro Package grants 5,000 where a Pro subscription grants 3,000. */
  pkg?: AlbumPackage | null
  /** Injected only by tests that need a fixed clock. */
  now?: Date
}

export type CapReason =
  | 'override'      // a per-album ceiling was set by hand; no upsell is appropriate
  | 'legacy'        // the album is grandfathered above what its plan gives today
  | 'package'       // a one-off package bought for this album decides it
  | 'plan'          // the owner's plan decides it
  | 'anon'          // no account behind the album — registering genuinely gives more

/** Hard ceiling on media_cap_override, so a typo can never create an unbounded-cost album. */
export const MAX_MEDIA_CAP_OVERRIDE = 200_000

/**
 * The cap for ONE PARTICULAR album, and WHY — the reason is what lets a caller phrase an honest
 * message instead of promising space that will not arrive.
 */
export function albumCap({ ownerTier, createdAt, override, pkg, now }: AlbumCapInput): { cap: number; reason: CapReason } {
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

  // A package bought for this album, if it is still in date. One more candidate in the same max()
  // — which is exactly the seam this function was written around.
  const pkgItems = !packageExpired(pkg, now ?? new Date()) && pkg?.tier
    ? PACKAGE_ITEMS_BY_TIER[pkg.tier]
    : 0

  // Only ever adds. This is the line that fixes the shadowing: a plan is never lowered to meet a
  // grandfathered ceiling, and a package never lowers either.
  const cap = Math.max(base, legacy, pkgItems)
  if (cap === pkgItems && pkgItems > base && pkgItems > legacy) return { cap, reason: 'package' }
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
// how much an album could hold. The only video control in the code was per-file SIZE. So one Pro
// album could legally hold 3,000 clips of ten minutes each: 30,000 stored minutes, about $150 a
// month, against a $4 plan.
//
// A BUDGET OF MINUTES, NOT A COUNT OF VIDEOS.
//
// I first built this as "up to N videos, each up to M seconds" and it was the wrong shape twice
// over. Cost is minutes — a budget bounds it exactly, where count x length only bounds the
// worst case and is wrong for everyone below it. And a count takes the choice away: somebody with
// twelve 20-second clips and one long speech is refused for reasons that have nothing to do with
// what they are costing. A budget lets the owner spend it however suits their event, and lets them
// make room by deleting rather than by arguing with a rule.
//
// There is no second limit beside it. A clip cap used to sit here doing a different job — stopping
// one long upload from taking the album's whole allowance — and it was removed deliberately: an
// album with eighteen minutes free refusing a two-minute speech is a rule the budget did not need.
// One long video CAN now spend the entire budget, and that is the intended behaviour, not a gap.
//
// WHY VIDEO IS BUDGETED AT ALL, when photos share one allowance: Cloudflare Stream bills per
// MINUTE STORED, every month, plus again per minute watched — while R2 bills per byte and charges
// nothing for delivery. Measured on this library, one minute of video costs what 300 photos cost
// per year. Worse, Stream storage is a PURCHASED CEILING (1,000 minutes per $5 unit) and exceeding
// it does not cost more, it makes every video upload fail for every album. So this budget is not
// really about money; it is about how much of a shared, hard limit one album may take.

// MINUTES PER ALBUM, AND NOTHING ELSE. There is deliberately no limit on how long ONE clip may be.
//
// The album's allowance is a pool of minutes and the owner spends it however they like: one
// twenty-minute video, or twenty one-minute videos, or anything between. Decided by the user on
// 2026-09-02, replacing a per-clip length cap that sat beside the pool and refused clips the album
// had room for. A guest who filmed a two-minute speech in an album with eighteen minutes free was
// told "videos can be up to 1 minute long" — a refusal the album's own budget did not require, and
// one they could do nothing about at the event.
//
// One number is also the only kind a guest can act on. Two limits meant a video could be refused
// for two different reasons with two different remedies, and the message had to guess which.
export type VideoCaps = {
  /** The album's whole video allowance, in seconds — spend it on many short clips or a few long. */
  maxTotalSeconds: number
}

// The busiest album on the platform today holds 7.2 minutes of video and the average holds 0.39,
// so free at 10 minutes is above everything real that exists. The per-account exposure is what
// these are actually sized against: albums-per-plan x this budget, against a 1,000-minute quota.
//   Free    3 albums x 10 min =    30 min
//   Pro    15 albums x 20 min =   300 min
//   Max    40 albums x 50 min = 2,000 min
const FREE_VIDEO_CAPS: VideoCaps = { maxTotalSeconds: 10 * 60 }
const PRO_VIDEO_CAPS: VideoCaps = { maxTotalSeconds: 20 * 60 }
const STUDIO_VIDEO_CAPS: VideoCaps = { maxTotalSeconds: 50 * 60 }

/**
 * Video limits for one album.
 *
 * An album with no account behind it gets the free limits rather than something tighter: its 250
 * ITEM cap already stops it long before video cost becomes interesting, and a guest album is the
 * first thing anybody tries — making it meaner than free buys nothing.
 */
export function videoCaps(ownerTier: Tier | null | undefined): VideoCaps {
  if (ownerTier === 'studio') return STUDIO_VIDEO_CAPS
  if (ownerTier === 'pro') return PRO_VIDEO_CAPS
  return FREE_VIDEO_CAPS
}

/**
 * Would adding this clip take the album past its budget?
 *
 * THE ONLY VIDEO LIMIT THERE IS. A clip of any length is welcome while the album has room for it,
 * so a twenty-minute video into an empty twenty-minute album is allowed and the same video into an
 * album with five minutes left is not.
 *
 * An unmeasured clip counts as zero, deliberately and in the album's favour. Measured on the live
 * library, 25 of 155 videos have no duration at all because the browser could not decode them —
 * one album is 15 for 15. Refusing what we could not measure would turn a failed metadata read on
 * someone's phone into a refusal they can do nothing about, at an event.
 *
 * What that costs, now that no per-clip cap bounds it: the overrun used to be at most one clip
 * length, and is now bounded instead by FALLBACK_MAX_DURATION in lib/stream-duration (15 minutes)
 * — Cloudflare refuses to process a pending upload longer than the duration it reserved, so an
 * unmeasured clip cannot silently be an hour. That bound is server-side and holds without the
 * client's cooperation, which is the half that matters.
 *
 * WHAT DOES NOT HAPPEN, stated because an earlier version of this comment claimed it did: the album
 * total is NOT reconciled after upload. /api/album/video-status can correct a duration, but its
 * only caller is the lightbox, firing when somebody OPENS a video — never on the upload path. At an
 * event, with guests uploading in sequence and nobody opening anything, no correction ever runs and
 * the next upload is judged on the client's claim. That route's own comment calls this "a known
 * residual", and a comment here is not allowed to promise what the code it points at disclaims
 * (rule 20). Do not treat this line as cover for removing another bound.
 */
export function videoBudgetExceeded(usedSeconds: number, newClipSeconds: unknown, caps: VideoCaps): boolean {
  const used = Number.isFinite(usedSeconds) && usedSeconds > 0 ? usedSeconds : 0
  const add = typeof newClipSeconds === 'number' && Number.isFinite(newClipSeconds) && newClipSeconds > 0
    ? newClipSeconds
    : 0
  // Already at or past the budget: refuse even a clip we could not measure, because the album has
  // demonstrably had its allowance. Below the budget, an unmeasured clip is let through.
  if (used >= caps.maxTotalSeconds) return true
  return used + add > caps.maxTotalSeconds
}

/**
 * How much video an album is holding, summed from its rows.
 *
 * EVERY ROW IS CLAMPED, NOT JUST THE TOTAL, and that distinction is the whole reason this function
 * exists. videoBudgetExceeded clamps the total (`used > 0 ? used : 0`), which sounds equivalent and
 * is not: one row of -2000000000 — accepted by photos/create, and storable because the column has
 * no CHECK — dragged the sum negative, the total-clamp read it as 0, and the album's video budget
 * was disabled permanently. Every upload after that was approved no matter how much it held.
 *
 * A negative duration is not a small error to be tolerated; it is not a duration. Same for NaN and
 * Infinity, which would poison the sum in their own ways. All of them count as zero, so a bad row
 * can cost the album a little unbilled video and can never buy an unlimited album.
 *
 * Exported and imported by the caller rather than re-typed there (rule 17): this is the arithmetic
 * that decides whether Cloudflare Stream cost is bounded at all.
 */
export function sumVideoSeconds(rows: { duration_seconds: number | null }[]): number {
  let total = 0
  for (const row of rows) {
    const d = row.duration_seconds
    if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) continue
    total += d
  }
  return total
}

/**
 * Cloudflare Stream's absolute maximum for one video. Nothing longer can exist there, so nothing
 * longer can be a real duration — which makes it the only honest upper bound for a stored value.
 * Mirrors CF_MAX_DURATION_CEILING in lib/stream-duration and the CHECK on photos.duration_seconds.
 */
export const MAX_STORED_DURATION_SECONDS = 21600

/**
 * What duration a video row may be charged, given what the SERVER approved for that upload.
 *
 * The client used to be believed here, and it was exploitable with two requests and no video at
 * all: /api/upload/stream with no durationSeconds is approved and stores nothing, then
 * photos/create with `duration_seconds: 2147483647` — which validatePhoto bounds below but not
 * above, and int4 holds exactly — put a number larger than any budget into the album's total. Every
 * later video upload was refused with "delete a video to make room", permanently; and with
 * require_approval on, the poison row is HIDDEN, so the owner could not see the video they were
 * being told to delete.
 *
 * So the client's number is not a fallback and is not an input. Only two things can come out of
 * here: what the server approved, or null.
 *
 * WHICH WAY THIS ERRS, and what each direction costs (rule 19). Null counts as zero against the
 * budget and /api/album/video-status corrects it from Cloudflare's own reading when someone opens
 * the video — so being wrong here costs some unaccounted minutes, bounded by the reservation
 * Cloudflare independently enforces. The other direction costs an album that can never take video
 * again, which no guest can fix and no owner can see.
 */
export function chargeableDurationSeconds(approvedByServer: number | null | undefined): number | null {
  if (typeof approvedByServer !== 'number' || !Number.isFinite(approvedByServer)) return null
  if (approvedByServer <= 0) return null
  return Math.min(Math.round(approvedByServer), MAX_STORED_DURATION_SECONDS)
}

/** Seconds of allowance left, never negative — for telling somebody what they have room for. */
export function videoBudgetLeft(usedSeconds: number, caps: VideoCaps): number {
  const used = Number.isFinite(usedSeconds) && usedSeconds > 0 ? usedSeconds : 0
  return Math.max(0, caps.maxTotalSeconds - used)
}

/** "2 minutes", "30 seconds" — for a refusal message that names the limit it hit. */
export function formatClipLimit(seconds: number): string {
  if (seconds % 60 === 0) {
    const mins = seconds / 60
    return mins === 1 ? '1 minute' : `${mins} minutes`
  }
  return `${seconds} seconds`
}

// ── THE VIDEO REFUSAL, WRITTEN ONCE ──────────────────────────────────────────────────────────
//
// There is one now, not two: the per-clip length refusal is gone with the cap it enforced. Its
// prefix is gone too rather than being left behind "just in case" — an unused constant that
// upload-policy still matches on is how a message nobody can produce keeps being handled forever.
//
// This is a DELIBERATE refusal, not a failure: the guest is being told a rule, and nothing is
// broken. lib/upload-policy has to recognise it by prefix for two separate reasons, and both
// are unpleasant when it cannot:
//
//   1. An unrecognised refusal is filed at 'error' level, so it lands in the admin Errors tab.
//      A 103 MB video refused twice once accounted for two of the four outstanding "errors" while
//      nothing was wrong.
//   2. Worse, an unrecognised video failure calls noteVideoOutcome(false), which collapses that
//      guest's video upload lane to serial FOR THE REST OF THE SESSION. One refused clip would
//      have slowed every later video that person uploaded.
//
// So the prefix and the message must be the same fact. They are built here, and upload-policy
// imports the prefixes rather than retyping them.
export const VIDEO_ALBUM_FULL_PREFIX = 'This album is out of video time'

export function videoAlbumFullMessage(caps: VideoCaps, usedSeconds: number): string {
  const left = videoBudgetLeft(usedSeconds, caps)
  const total = formatClipLimit(caps.maxTotalSeconds)
  return left > 0
    ? `${VIDEO_ALBUM_FULL_PREFIX} — ${total} in total, and only ${formatClipLimit(Math.floor(left))} left. `
      + 'Delete a video to make room, or add it as a photo.'
    : `${VIDEO_ALBUM_FULL_PREFIX} — it holds ${total} of video. `
      + 'Delete a video to make room. Photos can still be added.'
}

// ── WHAT DOES THIS ALBUM COUNT AS? ───────────────────────────────────────────────────────────
//
// Two completely different things can entitle one album, and they are independent:
//
//   the OWNER'S SUBSCRIPTION   per account, ongoing, covers every album they own
//   a PACKAGE bought for it    per album, one-off, covers that album for a fixed number of years
//
// So a free account can own a Max Package album, and a Pro subscriber can own an album with a Max
// Package on it. The album gets the BETTER of the two, always — never the average, never the most
// recent, and never whichever code path happened to ask first.
//
// This exists so the answer is computed once. Every feature gate in the product currently asks
// "what tier is the OWNER", which is the wrong question the moment a package exists: it would
// hand a paying package customer the free feature set because their account has no subscription.

export type AlbumPackage = {
  /** albums.package_tier — the feature set bought for this album, or null if none was. */
  tier: Exclude<Tier, 'free'> | null
  /** albums.package_expires_at — ISO timestamp. Null means no package. */
  expiresAt: string | null
}

const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, studio: 2 }

/** Has this album's package lapsed? Null/unparseable dates are treated as EXPIRED. */
export function packageExpired(pkg: AlbumPackage | null | undefined, now: Date = new Date()): boolean {
  if (!pkg || !pkg.tier || !pkg.expiresAt) return true
  const at = Date.parse(pkg.expiresAt)
  // An unreadable expiry errs toward expired, which sounds harsh and is the safe direction: an
  // album whose package we cannot date falls back to its OWNER's tier, so a subscriber loses
  // nothing and a free owner keeps every photo — features switch off, data never does. Erring the
  // other way would grant paid features forever off a corrupt string.
  if (!Number.isFinite(at)) return true
  return at <= now.getTime()
}

/**
 * The tier this ALBUM is entitled to — the better of its owner's subscription and its own package.
 *
 * Everything that gates a feature must ask this, not the owner's tier.
 */
export function albumEffectiveTier(
  ownerTier: Tier | null | undefined,
  pkg: AlbumPackage | null | undefined,
  now: Date = new Date(),
): Tier {
  const owner: Tier = ownerTier ?? 'free'
  if (packageExpired(pkg, now)) return owner
  const bought = pkg!.tier as Tier
  return TIER_RANK[bought] > TIER_RANK[owner] ? bought : owner
}
