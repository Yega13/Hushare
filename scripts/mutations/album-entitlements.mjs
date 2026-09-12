// Mutation set for src/lib/album-entitlements.ts -- run with:
//   node scripts/mutations/run.mjs album-entitlements
//
// What one album is allowed to hold: how many items, how many minutes of video, and which tier it
// counts as once a package is involved. This is the money file. A mutation that survives here is a
// customer either paying for something they do not get, or taking something they did not pay for --
// and both are silent, because a cap is just a number that comes back smaller.
//
// Four test files run together: the caps, the packages, the video budget, and the classifiers that
// read the same constants.
export default {
  file: 'src/lib/album-entitlements.ts',
  test: 'tests/album-entitlements.test.ts tests/album-packages.test.ts tests/video-caps.test.ts tests/limits-and-classifiers.test.ts',
  mutations: [
  // ── the item cap ──────────────────────────────────────────────────────────────────────────────
  { name: 'GRANDFATHERING SUBTRACTS AGAIN: a paid plan is lowered to meet an old ceiling (the shipped bug)',
    from: "  const cap = Math.max(base, legacy, pkgItems)", to: "  const cap = Math.min(...[base, legacy, pkgItems].filter((n) => n > 0))" },
  { name: 'the legacy promise is dropped, so an old album shrinks under what it was promised',
    from: "  const cap = Math.max(base, legacy, pkgItems)", to: "  const cap = Math.max(base, pkgItems)" },
  { name: 'a bought package no longer raises the ceiling it was bought for',
    from: "  const cap = Math.max(base, legacy, pkgItems)", to: "  const cap = Math.max(base, legacy)" },
  { name: 'a hand-set override is unbounded, so a typo becomes a million-item album',
    from: "    return { cap: Math.min(override, MAX_MEDIA_CAP_OVERRIDE), reason: 'override' }",
    to: "    return { cap: override, reason: 'override' }" },
  { name: 'an override of zero or below is honoured, so an album is capped at nothing',
    from: "  if (typeof override === 'number' && override > 0) {", to: "  if (typeof override === 'number') {" },
  { name: 'the override no longer outranks the plan',
    from: "  if (typeof override === 'number' && override > 0) {", to: "  if (false) {" },
  { name: 'an unreadable created_at SHRINKS the album instead of grandfathering it (rule 19, wrong way)',
    from: "  const dateUnknown = !Number.isFinite(created)", to: "  const dateUnknown = false" },
  { name: 'the two grandfather promises are merged, quietly breaking one of them',
    from: "  const beforeLegacyAll = dateUnknown || created < LEGACY_ALL_BEFORE",
    to: "  const beforeLegacyAll = dateUnknown || created < GRANDFATHER_FREE_BEFORE" },
  { name: 'the free-only promise is handed to every tier',
    from: "  const legacy = (beforeLegacyAll || (ownerTier === 'free' && beforeFreeDrop))",
    to: "  const legacy = (beforeLegacyAll || beforeFreeDrop)" },
  { name: 'the cutoff drifts by a day, silently changing what a day of albums was promised',
    from: "export const LEGACY_ALL_BEFORE = Date.parse('2026-08-02T00:00:00Z')",
    to: "export const LEGACY_ALL_BEFORE = Date.parse('2026-08-03T00:00:00Z')" },
  { name: 'an anonymous album is given the free-account allowance',
    from: "  const base = ownerTier ? albumMediaCapForTier(ownerTier) : ANON_ALBUM_MEDIA",
    to: "  const base = albumMediaCapForTier(ownerTier ?? 'free')" },
  { name: 'an expired package still pays out',
    from: "  const pkgItems = !packageExpired(pkg, now ?? new Date()) && pkg?.tier",
    to: "  const pkgItems = pkg?.tier" },
  { name: 'the package pays out at the wrong tier, so a Pro purchase gets the Max allowance',
    from: "    ? PACKAGE_ITEMS_BY_TIER[pkg.tier]", to: "    ? PACKAGE_ITEMS_BY_TIER.studio" },
  { name: 'the package allowance is retyped rather than read from the catalogue it was sold from',
    from: "  pro: PACKAGE_CATALOGUE.package_pro.items,", to: "  pro: 5000," },

  // ── what a full album is told to do about it ─────────────────────────────────────────────────
  { name: 'REGISTER is offered where registering leads back to the same ceiling (the useless message)',
    from: "  return albumCap({ ...input, ownerTier: 'free' }).cap > albumCap(input).cap\n}",
    to: "  return true\n}" },
  { name: 'a stranger with no account is told to upgrade a plan they have never heard of',
    from: "  if (!input.ownerTier) return false", to: "  if (false) return false" },
  { name: 'UPGRADE is offered to a Max owner whose album is simply full',
    from: "  return albumCap({ ...input, ownerTier: 'studio' }).cap > albumCap(input).cap",
    to: "  return true" },
  // NOT MUTATED -- swapping the two lines of capNudge is an EQUIVALENT mutation: one requires an
  // account and the other requires none, so at most one can ever be true and the order cannot
  // change an answer. Written down rather than left in the set to fail every run.

  // ── the video budget ─────────────────────────────────────────────────────────────────────────
  { name: 'every album gets the free video allowance, so Pro and Max pay for nothing',
    from: "  if (ownerTier === 'studio') return STUDIO_VIDEO_CAPS\n  if (ownerTier === 'pro') return PRO_VIDEO_CAPS\n", to: "" },
  { name: 'Pro is given the Max video allowance',
    from: "  if (ownerTier === 'pro') return PRO_VIDEO_CAPS", to: "  if (ownerTier === 'pro') return STUDIO_VIDEO_CAPS" },
  { name: 'an album with no account gets no video at all',
    from: "  return FREE_VIDEO_CAPS\n}", to: "  return { maxTotalSeconds: 0 }\n}" },
  { name: 'the free allowance is widened, and Stream storage is a purchased hard ceiling',
    from: "const FREE_VIDEO_CAPS: VideoCaps = { maxTotalSeconds: 10 * 60 }",
    to: "const FREE_VIDEO_CAPS: VideoCaps = { maxTotalSeconds: 60 * 60 }" },
  { name: 'an album already at its budget accepts an unmeasured clip, forever',
    from: "  if (used >= caps.maxTotalSeconds) return true\n", to: "" },
  { name: 'the budget is a floor rather than a ceiling: a clip that exactly fills it is refused',
    from: "  return used + add > caps.maxTotalSeconds", to: "  return used + add >= caps.maxTotalSeconds" },
  { name: 'an UNMEASURED clip is refused, turning a failed metadata read into a refusal at an event',
    from: "  const add = typeof newClipSeconds === 'number' && Number.isFinite(newClipSeconds) && newClipSeconds > 0\n    ? newClipSeconds\n    : 0",
    to: "  const add = typeof newClipSeconds === 'number' && Number.isFinite(newClipSeconds) && newClipSeconds > 0\n    ? newClipSeconds\n    : Infinity" },
  { name: 'a negative used-total is believed, so one bad row buys unlimited video (needed a NEW test: the old ones could not see it)',
    from: "  const used = Number.isFinite(usedSeconds) && usedSeconds > 0 ? usedSeconds : 0\n  const add",
    to: "  const used = usedSeconds\n  const add" },
  { name: 'the CLIENT is believed about how long a video was, which was exploitable',
    from: "  if (typeof approvedByServer !== 'number' || !Number.isFinite(approvedByServer)) return null", to: "  if (false) return null" },
  { name: 'a charged duration is unbounded, so one row can be six hours plus',
    from: "  return Math.min(Math.round(approvedByServer), MAX_STORED_DURATION_SECONDS)", to: "  return Math.round(approvedByServer)" },
  { name: 'a zero or negative approval is charged rather than refused',
    from: "  if (approvedByServer <= 0) return null\n", to: "" },
  { name: 'the remaining allowance can be negative, so the message offers room that is not there',
    from: "  return Math.max(0, caps.maxTotalSeconds - used)", to: "  return caps.maxTotalSeconds - used" },
  { name: 'the refusal prefix is reworded, so upload-policy stops recognising a refusal the product made itself',
    from: "export const VIDEO_ALBUM_FULL_PREFIX = 'This album is out of video time'",
    to: "export const VIDEO_ALBUM_FULL_PREFIX = 'This album has no video time left'" },
  { name: 'a whole number of minutes is printed as seconds',
    from: "  if (seconds % 60 === 0) {", to: "  if (false) {" },
  { name: 'one minute is printed as "1 minutes"',
    from: "    return mins === 1 ? '1 minute' : `${mins} minutes`", to: "    return `${mins} minutes`" },

  // ── which tier the album actually is ─────────────────────────────────────────────────────────
  // NOT MUTATED -- dropping `!pkg.expiresAt` is equivalent at runtime: Date.parse(null) is NaN and
  // the line below already returns true for that. The clause earns its place in the TYPE system
  // (it narrows string | null to string), which vitest cannot observe and tsc does.
  { name: 'an unreadable expiry grants paid features forever off a corrupt string',
    from: "  if (!Number.isFinite(at)) return true", to: "  if (!Number.isFinite(at)) return false" },
  { name: 'a package stays live on the exact second it expires',
    from: "  return at <= now.getTime()", to: "  return at < now.getTime()" },
  { name: 'the package is compared against the wrong clock direction, so every package reads expired',
    from: "  return at <= now.getTime()", to: "  return at >= now.getTime()" },
  { name: 'the album takes its package tier even when the owner subscribes to a HIGHER one',
    from: "  return TIER_RANK[bought] > TIER_RANK[owner] ? bought : owner", to: "  return bought" },
  { name: 'the album ignores its package and asks the owner account -- the free-features-for-a-buyer bug',
    from: "  return TIER_RANK[bought] > TIER_RANK[owner] ? bought : owner", to: "  return owner" },
  { name: 'a null owner tier is not defaulted, so an anonymous album reads as no tier at all',
    from: "  const owner: Tier = ownerTier ?? 'free'", to: "  const owner: Tier = ownerTier as Tier" },

  // ── the refusal a full album gives, at either door (2026-09-11) ─────────────────────────────
  { name: 'the full-album refusal loses its code, so the banner cannot tell it from a failure',
    from: "  return { code: 'album_full', nudge, error: `You've reached this album's upload limit.${suffix}` }",
    to: "  return { code: 'full', nudge, error: `You've reached this album's upload limit.${suffix}` }" },
  { name: 'the register advice is swapped for the upgrade advice',
    from: "Register on Hushare — it's free — for more space.", to: "Upgrade your plan for more space." },
  { name: 'the nudge is not attached, so the banner guesses',
    from: "  return { code: 'album_full', nudge, error:", to: "  return { code: 'album_full', nudge: 'none' as const, error:" },

  // ── was the tier what decided this cap (2026-09-12, round two) ───────────────────────────────
  { name: 'AN OVERRIDE ALBUM IS SAID TO DEPEND ON ITS TIER, so a degraded lookup stops enforcing it',
    from: "  if (typeof override === 'number' && override > 0) return false\n  return ownerTier !== null && ownerTier !== undefined",
    to: "  return ownerTier !== null && ownerTier !== undefined" },
  { name: 'an anonymous album is said to depend on a tier it never reads',
    from: "  return ownerTier !== null && ownerTier !== undefined", to: "  return true" },
  { name: 'no cap depends on the tier, so a guessed tier enforces every cap',
    from: "  return ownerTier !== null && ownerTier !== undefined", to: "  return false" },
  ],
}
