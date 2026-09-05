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
