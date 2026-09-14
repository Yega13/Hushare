// A `next` PARAMETER NAMES A PAGE ON THIS SITE, OR NOTHING.
//
// Sign-in carries the page to return to in `?next=`, and six places checked it the same way: parse it
// against our origin, require the same origin, then redirect to its pathname and query. That checks the
// wrong thing. `https://hushare.space//evil.example` IS same-origin -- its pathname is `//evil.example` --
// and a pathname that starts with two slashes is a link to another HOST the moment it is used as a
// redirect. So is `https://hushare.space/\evil.example`, because the URL parser turns the backslash into
// a slash. Both were run through Node's URL parser on 2026-09-14 and both land on https://evil.example:
// a sign-in link that hands a freshly signed-in visitor to a page built to look like ours (review of
// 2026-09-14).
//
// The check that matters is where the redirect LANDS, so that is what this checks: the path it returns
// is resolved against our origin once more, exactly as a browser or a Location header would resolve it,
// and anything that lands elsewhere is refused. Errs toward no destination -- a refused `next` sends the
// visitor to the default page, never somewhere unchecked.
//
// No imports: the login form runs this in the browser, and the routes run it on the server.

/** The same-site path to return to, or null when `raw` would lead anywhere else. The fragment is dropped. */
export function safeNextPath(raw: string | null | undefined, origin: string): string | null {
  if (!raw) return null
  let parsed: URL
  try {
    parsed = new URL(raw, origin)
  } catch {
    return null
  }
  if (parsed.origin !== origin) return null
  const path = parsed.pathname + parsed.search
  let landing: URL
  try {
    landing = new URL(path, origin)
  } catch {
    return null
  }
  return landing.origin === origin ? path : null
}
