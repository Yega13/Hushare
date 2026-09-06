// NARROW ROWS ON COLUMNS A QUERY FILTERED BUT THE COMPILER CANNOT SEE.
//
// A PostgREST filter such as `.gt('package_expires_at', now)` or `.not('package_tier', 'is', null)`
// guarantees at runtime that the column is non-null in every returned row -- and the generated row
// type still says `string | null`, because the type comes from the schema, not from the query. For a
// long time a `.returns<{ package_expires_at: string }[]>()` on the query papered over that by
// asserting the shape; when those casts came off, the crons needed the guarantee established in code.
//
// WHY THIS IS A MODULE AND NOT AN INLINE `.filter((a): a is ...)` AT EACH CALL SITE. The first
// version WAS inline, and a rule-16 mutation exposed what that buys: neutering the predicate's BODY to
// `true` left tsc perfectly green, because a type predicate narrows by its SIGNATURE -- `a is T & {..}`
// -- and the compiler never checks that the body earns it. An inline predicate is a cast with better
// manners: the claim is in the annotation, the runtime check is in the body, and nothing holds the
// two together. Here the body has a test (tests/non-null.test.ts) and the signature has tsc at every
// call site, so a mutation to either is caught by something.
//
// ERRS TOWARD SKIPPING (rule 19): a row the filter should have excluded is left out, never passed
// through with a null where the type says string. Given the query already excluded it, the skip is a
// no-op on every real row; it exists for the day the query and this list disagree.

type WithNonNull<T, K extends keyof T> = T & { [P in K]: NonNullable<T[P]> }

/**
 * Keep only the rows where every named key is non-null, and type them so.
 *
 * `keys` is the explicit list of columns the query filtered -- written at the call site next to the
 * query, so the reader sees the two together and can check they agree.
 */
export function withNonNull<T, K extends keyof T>(rows: readonly T[], ...keys: K[]): WithNonNull<T, K>[] {
  const out: WithNonNull<T, K>[] = []
  for (const row of rows) {
    let ok = true
    for (const k of keys) {
      if (row[k] === null || row[k] === undefined) { ok = false; break }
    }
    if (ok) out.push(row as WithNonNull<T, K>)
  }
  return out
}

/**
 * What one run says about rows a query promised were non-null and were not -- or null, which is
 * every run today.
 *
 * withNonNull errs toward skipping (above), and a skip nobody hears about is the silent failure
 * this codebase keeps paying for: a renewal reminder that never went out looks exactly like one
 * that was not due. The message is STABLE and the count rides in context, so that /admin, which
 * groups by exact message, marks a repeat as seen-before rather than as a fresh incident. (It does
 * NOT collapse a daily cron's reports into one row: coalesce_error_event merges only within five
 * minutes, so a row dropped every morning is a row in the panel every morning -- which is the
 * intended amount of noise for a reminder that is not going out. The count is written to context
 * for the query that follows; the panel does not render it.)
 */
export function nullDropReport(
  scanned: number,
  kept: number,
  keys: readonly string[],
): { message: string; context: { scanned: number; dropped: number; keys: string[] } } | null {
  if (kept === scanned) return null
  return {
    message: `rows the query filtered as non-null arrived null: ${keys.join(', ')}`,
    context: { scanned, dropped: scanned - kept, keys: [...keys] },
  }
}
