// Mutations for lib/bib-filter.ts — the rule that decides which numbers on a photograph are bibs.
//
// The defect it fixes was measured, not imagined: on the one real race album the old rule stored
// 2026 on 1,145 photos (the finish arch), and 044/499/700 on ~480 each — one advertising
// billboard's phone number, split into three tags. A runner searching 44 got 485 photographs of
// somebody else's race.
//
// Every mutation below is a way this rule could quietly go back to that, or start throwing away
// real bibs instead. The line-count mutations are the important ones: they are the difference
// between "alone on its line" and "somewhere on a line", which is the whole rule.
export default {
  file: 'src/lib/bib-filter.ts',
  test: 'tests/bib-filter.test.ts',
  mutations: [
    {
      name: 'the line rule is deleted — every number in the frame is a bib again',
      from: "    if ((wordsPerLine.get(w.lineId) ?? 0) !== 1) continue",
      to: '    if (false) continue',
    },
    {
      name: 'the line rule is loosened to "at most two words" — readmits 23 AUGUST 2026',
      from: '(wordsPerLine.get(w.lineId) ?? 0) !== 1',
      to: '(wordsPerLine.get(w.lineId) ?? 0) > 2',
    },
    {
      name: 'the line rule is inverted — only CROWDED lines count',
      from: '(wordsPerLine.get(w.lineId) ?? 0) !== 1',
      to: '(wordsPerLine.get(w.lineId) ?? 0) === 1',
    },
    {
      name: 'a missing line is treated as isolation rather than as missing information',
      from: '    if (w.lineId === null || w.lineId === undefined) continue\n    if ((wordsPerLine',
      to: '    if (w.lineId === null || w.lineId === undefined) { out.push({ number: digits, confidence: w.confidence }); continue }\n    if ((wordsPerLine',
    },
    {
      name: 'only NUMERIC words are counted per line — 2144 HALF MARRATHON reads as isolated',
      from: '    if (w.lineId === null || w.lineId === undefined) continue\n    wordsPerLine.set',
      to: '    if (w.lineId === null || w.lineId === undefined) continue\n    if (bibDigitsOf(w.text) === null) continue\n    wordsPerLine.set',
    },
    {
      name: 'the dedup keeps the FIRST reading instead of the most confident one',
      from: '    if (prev === undefined || w.confidence > prev.confidence) best.set(digits, w)',
      to: '    if (prev === undefined) best.set(digits, w)',
    },
    {
      name: 'the dedup keeps the LEAST confident reading',
      from: 'w.confidence > prev.confidence',
      to: 'w.confidence < prev.confidence',
    },
    {
      name: 'the confidence floor is removed — unreadable digits become bibs',
      from: '    if (!Number.isFinite(w.confidence) || w.confidence < minConfidence) continue',
      to: '    if (false) continue',
    },
    {
      name: 'the confidence floor becomes exclusive, dropping a reading exactly at it',
      from: 'w.confidence < minConfidence',
      to: 'w.confidence <= minConfidence',
    },
    {
      name: 'a non-finite confidence is admitted rather than refused',
      from: '!Number.isFinite(w.confidence) || w.confidence < minConfidence',
      to: 'w.confidence < minConfidence',
    },
    {
      name: 'the digit-length ceiling is dropped — timestamps and phone numbers qualify',
      from: '  if (cleaned.length > MAX_BIB_DIGITS) return null',
      to: '  if (false) return null',
    },
    {
      name: 'the ceiling is off by one',
      from: 'if (cleaned.length > MAX_BIB_DIGITS) return null',
      to: 'if (cleaned.length > MAX_BIB_DIGITS + 1) return null',
    },
    {
      name: 'non-digit tokens are accepted as bibs',
      from: '  if (!/^[0-9]+$/.test(cleaned)) return null',
      to: '  if (false) return null',
    },
    {
      name: 'leading zeros are stripped, so a padded bib stops matching what a runner types',
      from: '  return cleaned',
      to: '  return String(Number(cleaned))',
    },
  ],
}
