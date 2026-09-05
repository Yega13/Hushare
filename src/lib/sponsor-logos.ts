import type { SponsorLogo } from '@/types'

// THE ONE PLACE ARBITRARY JSON BECOMES A SponsorLogo.
//
// `albums.sponsor_logos` is a jsonb column. The database guarantees it is valid JSON and NOTHING
// else — not that it is an array, not that entries are objects, not that `url` is a string. The row
// is written by the sponsors API, but rows written by older versions of that API are still in the
// table, and jsonb keeps whatever it was given.
//
// MISTAKES.md records what that cost: a `url` field holding a NUMBER, and `startsWith` called on it
// mid-deletion. The type said SponsorLogo[], so nothing looked. Every deletion path was afterwards
// hardened to treat the column as `unknown` and check defensively — three separate places each
// doing their own narrowing, which is rule 13 waiting to happen.
//
// This is the single conversion. resolveAlbum calls it once, at the only point where a database row
// becomes the Album the rest of the product uses, so everything downstream can rely on the type
// rather than re-checking it.
//
// ERRS TOWARD DROPPING (rule 19): an entry that is not usable is left out rather than passed along
// as a half-object. A missing sponsor mark is a visible, reportable absence; a mark whose `url` is
// a number is a crash somewhere unrelated, hours later.

function isUsable(entry: unknown): entry is { id: unknown; url: string; name?: unknown } {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
  const url = (entry as { url?: unknown }).url
  // `url` is the field that threw. It has to be a non-empty string or the entry is useless: it
  // cannot be rendered, and it cannot be turned into an R2 key for deletion.
  return typeof url === 'string' && url.length > 0
}

export function parseSponsorLogos(value: unknown): SponsorLogo[] {
  if (!Array.isArray(value)) return []
  const out: SponsorLogo[] = []
  for (const entry of value) {
    if (!isUsable(entry)) continue
    const id = (entry as { id?: unknown }).id
    const name = (entry as { name?: unknown }).name
    out.push({
      // A missing or non-string id still renders and still deletes — the url is what identifies the
      // object in storage — so it is coerced rather than being a reason to drop the mark.
      id: typeof id === 'string' ? id : entry.url,
      url: entry.url,
      name: typeof name === 'string' ? name : null,
    })
  }
  return out
}
