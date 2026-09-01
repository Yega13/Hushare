// The comp script's ONE judgement, in a file a test can import.
//
// scripts/comp-album-cap.mjs opens a database connection at import time, so nothing inside it can
// be imported by a test — which is why its bound check went untested and a mutation replacing the
// whole condition with `if (false)` left the suite green. The constant was pinned to
// MAX_MEDIA_CAP_OVERRIDE and the code that USES it was not: rule 15, on the single lever that
// outranks every tier, package and grandfathering rule.
//
// Returns an error string, or null when the value is acceptable.

export function validateCap(raw, maxCap) {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0 || n > maxCap) {
    return `--cap needs a whole number between 1 and ${maxCap.toLocaleString('en-US')}`
  }
  return null
}
