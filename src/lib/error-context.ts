/**
 * BOUNDING THE CONTEXT BLOB ON A CLIENT ERROR REPORT, without throwing the useful part away.
 *
 * api/log/client-error accepts a small `context` object from an untrusted browser — digest, build
 * id, path, stack, repeat counters. It has to be bounded, because anyone can POST to that endpoint
 * and a fat context is a cheap way to bloat the table.
 *
 * It used to be bounded ALL-OR-NOTHING:
 *
 *     const s = JSON.stringify(body.context)
 *     if (s.length <= 800) context = body.context     // else: null, silently
 *
 * which drops the whole object when any single field is long. The field that gets long is the
 * STACK, so the reports that lost all their context were exactly the ones worth reading — a crash
 * deep enough to have a big stack arrived with no digest, no build id and no path, and looked
 * identical to a report that never carried any.
 *
 * Clamping each value instead keeps every KEY and shortens only what is too long. A hostile client
 * still cannot bloat a row: the per-value clamp and the total cap both still apply, and the total
 * cap still drops the object outright if the clamped result is somehow still too big.
 *
 * Deliberately shallow. The contexts this product sends are flat, and recursing would be a way to
 * spend CPU on somebody else's nested input.
 */

/** Longest single string value kept. Enough stack to get past framework frames to ours. */
export const MAX_VALUE_CHARS = 700
/** Hard ceiling on the serialized object, after clamping. Bounds the row whatever arrives. */
export const MAX_CONTEXT_CHARS = 1400
/** Most keys kept. A flat report has under a dozen; anything more is padding. */
export const MAX_CONTEXT_KEYS = 24

/**
 * NOTHING AFTER A `?` OR A `#` IN A URL IS STORED.
 *
 * An owner's link carries their capability in the fragment -- `/<slug>#owner=<token>` -- precisely
 * because browsers never send a fragment to a server (rule 25). Error reporting sent it anyway: a
 * window error's filename is the full page URL, and on 2026-09-10 an owner opening their own album
 * on Chrome for iPhone put a live owner token into error_events, readable by anyone who can read the
 * admin panel. Query strings are no better: a presigned R2 URL carries its signature there, and an
 * auth callback carries a one-time code.
 *
 * So every URL in a stored string loses its query and fragment, and the secret-bearing keys are
 * redacted wherever they appear, in case one arrives without a URL around it. Applied on the
 * SERVER, because a tab still running an older bundle keeps sending whatever it sends; the client
 * runs the same function over what it sends, so the secret does not leave the browser either.
 *
 * Backslashes and quotes end a match, so running this over serialized JSON cannot break an escape
 * or cross a string boundary. Errs toward removing (rule 19): a stack frame from an inline script
 * loses its line and column along with the fragment. That costs a location we could have read;
 * keeping it costs a key to somebody's album.
 */
const URL_QUERY_OR_FRAGMENT = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>()\\]*)[?#][^\s"'<>()\\]*/gi
const SECRET_PAIR = /\b(owner|access_token|refresh_token|provider_token|token_hash)=[^\s&#"'<>()\\]*/gi

export function stripUrlSecrets(text: string): string {
  return text.replace(URL_QUERY_OR_FRAGMENT, '$1').replace(SECRET_PAIR, '$1=[redacted]')
}

/**
 * Returns the context to store, or null when there is nothing worth storing.
 *
 * Errs toward keeping a trimmed object rather than dropping a whole one: a truncated stack is still
 * a stack, and the digest beside it is what ties a browser report to the server log line (rule 19).
 */
// The return type states what the body below already guarantees: every value stored is a clamped
// string, a FINITE number, or a boolean. Nulls and undefined are skipped, objects and arrays are
// serialized to a string, and anything unserializable is dropped. It was declared
// `Record<string, unknown>`, which understated that — and `unknown` is not assignable to the Json
// type the jsonb column actually holds, so the honest signature is also the one that compiles.
export function boundedContext(input: unknown): Record<string, string | number | boolean> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null

  const out: Record<string, string | number | boolean> = {}
  let keys = 0
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (keys >= MAX_CONTEXT_KEYS) break
    if (v === null || v === undefined) continue
    if (typeof v === 'string') {
      // Stripped BEFORE the clamp. Either order removes the secret; this one gives the room the
      // fragment took to whatever follows it, instead of cutting that off.
      const clean = stripUrlSecrets(v)
      out[k] = clean.length > MAX_VALUE_CHARS ? clean.slice(0, MAX_VALUE_CHARS) : clean
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      // A non-finite number is not JSON — JSON.stringify turns it into null, so the key would
      // survive with a meaningless value. Drop it instead of storing a lie.
      if (typeof v === 'number' && !Number.isFinite(v)) continue
      out[k] = v
    } else {
      // Objects and arrays are flattened to their serialized form and clamped like a string, so a
      // nested blob costs the same as a long string and no more.
      let s: string
      try {
        s = JSON.stringify(v) ?? ''
      } catch {
        continue   // circular or otherwise unserializable: not worth a 500 on a logging endpoint
      }
      if (s) out[k] = stripUrlSecrets(s).slice(0, MAX_VALUE_CHARS)
    }
    keys++
  }

  if (keys === 0) return null
  // Still too big after clamping — only reachable by many keys at once, which is padding, not a
  // report. Dropping is right here; the point of the clamp above is that this is now rare rather
  // than routine.
  if (JSON.stringify(out).length > MAX_CONTEXT_CHARS) return null
  return out
}
