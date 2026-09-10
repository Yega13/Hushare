// Mutations for lib/bib-exclusions.ts — the owner-confirmed list of numbers that are not runners.
//
// This is the half of bib search that a rule cannot do. lib/bib-filter removes 96.3% of the noise
// by refusing any number sharing its OCR line; what is left is a year printed ALONE on a finish
// arch, which is typographically identical to a bib on a chest. On the measured race that answered
// on ~75 photographs. Frequency cannot separate them — the 69-photo album had its banner year and
// the real bib 00663 on exactly 4 photographs each — so a person decides, and every mutation below
// is a way that decision could be quietly ignored or quietly over-applied.
//
// The direction that matters most is over-application: a wrong exclusion hides a runner's own
// photographs from them, and they never learn to complain.
export default {
  file: 'src/lib/bib-exclusions.ts',
  test: 'tests/bib-exclusions.test.ts',
  mutations: [
    {
      name: 'exclusions compare by TEXT, so a padded stored number escapes the list',
      from: '  return String(Number(digits))',
      to: '  return digits',
    },
    {
      name: 'the number shape is not checked, so junk becomes a comparable key',
      from: '  if (!/^[0-9]{1,6}$/.test(digits)) return null',
      to: '  if (false) return null',
    },
    {
      name: 'a # or N prefix is no longer stripped, so #2026 and 2026 stop being one number',
      from: "  const digits = n.trim().replace(/^[#nN°]/, '')",
      to: '  const digits = n.trim()',
    },
    {
      name: 'isExcludedNumber matches on a substring rather than the whole value',
      from: '  for (const e of excluded) if (numericKey(e) === key) return true',
      to: '  for (const e of excluded) if (String(e).includes(key)) return true',
    },
    {
      name: 'isExcludedNumber treats an unparseable candidate as excluded (rule 19, wrong way)',
      from: '  if (key === null) return false',
      to: '  if (key === null) return true',
    },
    {
      name: 'the empty-list shortcut lies and reports everything excluded',
      from: '  if (excluded.length === 0) return false',
      to: '  if (excluded.length === 0) return true',
    },
    {
      name: 'the candidate list stops hiding what is already excluded, so it re-offers it forever',
      from: '      return key !== null && !already.has(key)',
      to: '      return key !== null',
    },
    {
      name: 'candidates are ordered least-seen first, burying the banner year',
      from: '    .sort((a, b) => b.photos - a.photos || a.number.localeCompare(b.number))',
      to: '    .sort((a, b) => a.photos - b.photos || a.number.localeCompare(b.number))',
    },
    {
      name: 'the tie-break is dropped, so the panel reshuffles under the owner between renders',
      from: 'b.photos - a.photos || a.number.localeCompare(b.number)',
      to: 'b.photos - a.photos',
    },
    {
      name: 'the asking floor is removed and one-off misreads flood the panel',
      from: '    .filter((t) => Number.isFinite(t.photos) && t.photos >= CANDIDATE_MIN_PHOTOS)',
      to: '    .filter(() => true)',
    },
    {
      name: 'the list is unbounded, so a long tail is offered all at once',
      from: '    .slice(0, Math.max(0, Math.floor(max)))',
      to: '    .slice()',
    },
    {
      name: 'normalizeExclusions stops de-duplicating, so one number is stored several ways',
      from: '    if (key === null || seen.has(key)) continue',
      to: '    if (key === null) continue',
    },
    {
      name: 'the stored list is unbounded',
      from: '    if (out.length >= MAX_EXCLUSIONS) break',
      to: '    if (false) break',
    },
    {
      name: 'normalizeExclusions keeps non-strings, so a number or an object reaches the column',
      from: "    if (typeof raw !== 'string') continue",
      to: '    if (false) continue',
    },
  ],
}
