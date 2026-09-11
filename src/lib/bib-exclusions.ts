// THE NUMBERS THAT ARE NOT RUNNERS, DECIDED BY A PERSON.
//
// lib/bib-filter removes 96.3% of the noise by refusing any number that shares its OCR line, which
// is what a sponsor's phone number and a dated banner look like. What it cannot reach is a number
// printed ALONE: the year across a finish arch is typographically identical to a bib on a chest,
// and on the one measured race it survived on about 75 photos. Low integers survive too -- podium
// boards, kilometre markers, price signs -- and those are the numbers a runner is most likely to
// type. Every race has both.
//
// NO AUTOMATIC RULE MAY REMOVE THESE, and that is measured rather than assumed. Frequency looks
// like the answer and is not: on the smaller of the two albums the banner year "2026" and the real
// bib "00663" each appeared on exactly 4 of 69 photos. The migration that added the bib range wrote
// this down before either of us tried it -- "Frequency does NOT separate them... A 'seen too often'
// rule deletes real runners" -- and a later measurement confirmed it, because a threshold safe on a
// 4,566-photo album sits below the entire real-bib population on a 69-photo one. A real bib appears
// on 1-4 photos whatever the album size; any album-relative floor scales with the album.
//
// So frequency NOMINATES and a human confirms. The owner recognises the year on their own arch in
// one glance, which is a question they can answer -- unlike "what is your bib range?", which the one
// real organiser answered with 1-3000 for a race whose numbers run 153-2176.
//
// APPLIED AT SEARCH TIME, never at indexing. Correcting the list then re-filters every photograph
// at once, with no re-OCR, no AWS bill, and no window in which the album answers "no photos" while
// it is being rebuilt. That is the same choice the bib range already made, for the same reason.

/** One number and how many photographs of this album it was read on. */
export type NumberTally = {
  number: string
  photos: number
  /** One photograph the number was read on -- the thing that makes the question answerable at a
   *  glance instead of from a bare number. Null on a legacy row with no thumbnail. */
  sampleThumb?: string | null
}

/**
 * How many photographs a number must appear on before it is worth asking about.
 *
 * A floor on the QUESTION, not on the answer: nothing is removed by it. Its only job is to keep a
 * list of one-off misreads out of a panel a person has to scan. Deliberately low, because on a
 * small album a banner appears only a handful of times -- the 69-photo race had its year on 4.
 */
export const CANDIDATE_MIN_PHOTOS = 2

/** How many to offer at once. */
export const CANDIDATE_MAX = 20

/**
 * One row per NUMBER, where the tallies count spellings.
 *
 * The tally RPC groups by the literal string OCR read, and OCR keeps leading zeros -- so an arch
 * year read as "2026" on 1,105 photographs and "02026" on 40 arrives as two tallies. Left alone
 * they become two rows for one number: the count that carries the whole argument ("a quarter of
 * your album") is split across both, two of the twenty slots go to one value, and the owner sees a
 * number listed twice -- which is the exact symptom this panel was redesigned to remove.
 *
 * THE COUNT IS SUMMED, and the direction it can err is worth stating exactly. Summing over-counts
 * when ONE photograph carries both spellings. lib/bib-filter no longer produces that -- it keys its
 * per-photograph map by VALUE -- but rows indexed before that change still hold it, measured at 2 of
 * 4,697. The line rule does NOT prevent it and this comment once claimed it did: "alone on its line"
 * and "once per photograph" are different guarantees, and only the first was ever enforced here.
 * Across different photographs, which is the real case, the sum is exact.
 *
 * The error is never in the safe direction: an over-count only makes a number look MORE like
 * signage, and it decides an outcome only at CANDIDATE_MIN_PHOTOS, where one photograph is the
 * whole difference between a number being offered for exclusion and never being mentioned.
 *
 * THE SPELLING SEEN MOST OFTEN LABELS THE ROW, with its photograph, because that is the one the
 * owner is most likely to recognise. Which spelling wins does not affect what gets excluded:
 * everything downstream compares by value.
 */
export function mergeTalliesByValue(tallies: readonly NumberTally[]): NumberTally[] {
  const merged = new Map<string, { row: NumberTally; topPhotos: number }>()
  for (const t of tallies) {
    // Dropped before the sum, never after: one NaN would otherwise poison the whole number.
    if (!Number.isFinite(t.photos)) continue
    const key = numericKey(t.number)
    if (key === null) continue
    const prev = merged.get(key)
    if (prev === undefined) {
      merged.set(key, {
        row: { number: t.number, photos: t.photos, sampleThumb: t.sampleThumb ?? null },
        topPhotos: t.photos,
      })
      continue
    }
    prev.row.photos += t.photos
    // On a TIE the shorter spelling wins, because the RPC orders ties by text and "02026" sorts
    // before "2026" -- so first-seen-wins would label the row with the padded form the owner is
    // least likely to recognise. Cosmetic only: everything downstream compares by value.
    if (t.photos > prev.topPhotos
      || (t.photos === prev.topPhotos && t.number.length < prev.row.number.length)) {
      prev.topPhotos = t.photos
      prev.row.number = t.number
      if (t.sampleThumb) prev.row.sampleThumb = t.sampleThumb
    } else if (!prev.row.sampleThumb) {
      prev.row.sampleThumb = t.sampleThumb ?? null
    }
  }
  return [...merged.values()].map((m) => m.row)
}

/**
 * The numbers to put in front of the owner, most-seen first.
 *
 * TOP-20 RATHER THAN TOP-5, from a real finding: the five loudest numbers on the measured album
 * were the arch year and one billboard's phone number, and immediately behind them sat 2020 (76
 * photos), 202 (67) and 2028 (41) -- banner misreads that a shorter list would leave behind while
 * the owner believed they had cleared the noise.
 *
 * Numbers already excluded are not offered again; the panel shows those separately so they can be
 * put back.
 */
export function exclusionCandidates(
  tallies: readonly NumberTally[],
  excluded: readonly string[] = [],
  max: number = CANDIDATE_MAX,
): NumberTally[] {
  const already = new Set(excluded.map(numericKey).filter((k): k is string => k !== null))
  return mergeTalliesByValue(tallies)
    .filter((t) => Number.isFinite(t.photos) && t.photos >= CANDIDATE_MIN_PHOTOS)
    .filter((t) => {
      const key = numericKey(t.number)
      return key !== null && !already.has(key)
    })
    .slice()
    // Most-seen first; ties by the number itself so the list does not reshuffle between renders.
    .sort((a, b) => b.photos - a.photos || a.number.localeCompare(b.number))
    .slice(0, Math.max(0, Math.floor(max)))
}

/**
 * Every number the panel puts on screen, ordered, with what is known about each.
 *
 * AN EXCLUDED NUMBER KEEPS ITS PHOTOGRAPH AND ITS COUNT. `exclusionCandidates` drops what is
 * already excluded, which is right for "what should I be asked about" and wrong for "what am I
 * looking at": the owner reopened the panel and found the number they had switched off reduced to
 * a struck-through digit string with a blank square where its photograph had been, sitting at the
 * bottom of the list. Undoing an exclusion is the property this whole panel is built around
 * (a wrong one hides a runner from their own search and produces no complaint), and it cannot be
 * done from evidence that has been taken away. The tally is already in the same response.
 *
 * ORDERED BY COUNT ACROSS BOTH, so a row does not move when it is tapped. Appending the excluded
 * set after the candidates sent the loudest number on the album -- always the first thing excluded
 * -- to the far end of the list on the next open, which reads as "it is gone" rather than "it is
 * off".
 *
 * A number excluded with no tally behind it still gets a row, at zero. That is an exclusion made
 * before this panel existed, or one whose photographs have since been deleted; dropping it would
 * make it permanent and invisible.
 */
export function exclusionRows(
  tallies: readonly NumberTally[],
  excluded: readonly string[] = [],
  max: number = CANDIDATE_MAX,
): NumberTally[] {
  // Merged ONCE, and handed to both halves: an excluded row must show the same combined count the
  // owner was offered, not whichever spelling happened to be stored.
  const byValue = mergeTalliesByValue(tallies)
  const rows: NumberTally[] = exclusionCandidates(byValue, excluded, max)
  const seen = new Set(rows.map((r) => numericKey(r.number)))

  const byKey = new Map<string, NumberTally>()
  for (const t of byValue) {
    const key = numericKey(t.number)
    if (key !== null && !byKey.has(key)) byKey.set(key, t)
  }

  for (const e of excluded) {
    const key = numericKey(e)
    if (key === null) continue
    if (seen.has(key)) continue
    seen.add(key)
    // THE STORED SPELLING WINS for `number`, never the tally's. OCR keeps leading zeros, so the
    // same runner is "00945" on one photograph and "945" in the list; a row labelled with the
    // tally's spelling would not be recognised as excluded by anything comparing text.
    const tally = byKey.get(key)
    rows.push({ number: e, photos: tally?.photos ?? 0, sampleThumb: tally?.sampleThumb ?? null })
  }

  return rows.sort((a, b) => b.photos - a.photos || a.number.localeCompare(b.number))
}

/**
 * The comparable form of a number, or null if it is not one.
 *
 * BY VALUE, NOT BY TEXT, and this is the whole reason the function exists. Bib numbers are stored
 * as OCR read them, leading zeros and all: the same runner is "00945" on one photograph and "945"
 * on another. An owner excluding "2026" from a list means the value, so a stored "02026" has to go
 * with it. bibMatches already compares this way; matching exclusions any other way would leave the
 * two halves of one feature disagreeing about what a number is.
 */
export function numericKey(n: string): string | null {
  const digits = n.trim().replace(/^[#nN°]/, '')
  if (!/^[0-9]{1,6}$/.test(digits)) return null
  return String(Number(digits))
}

/**
 * Has the owner marked this number as something other than a runner?
 *
 * Errs toward NOT excluded: an unparseable stored value or an unparseable entry in the list is
 * ignored rather than treated as a match, because a wrong exclusion hides a runner's photographs
 * from them and they will never know to complain (rule 19).
 */
export function isExcludedNumber(candidate: string, excluded: readonly string[]): boolean {
  if (excluded.length === 0) return false
  const key = numericKey(candidate)
  if (key === null) return false
  for (const e of excluded) if (numericKey(e) === key) return true
  return false
}

/** The album's stored list, cleaned: comparable, de-duplicated, and bounded. */
export const MAX_EXCLUSIONS = 200

export function normalizeExclusions(input: readonly unknown[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const key = numericKey(raw)
    if (key === null || seen.has(key)) continue
    seen.add(key)
    out.push(key)
    if (out.length >= MAX_EXCLUSIONS) break
  }
  return out
}
