// HOW MANY IDS MAY GO INTO ONE `.in(...)` FILTER.
//
// PostgREST takes filters in the QUERY STRING, so `.in('id', ids)` puts every id into the URL —
// about 37 characters each. Past roughly 16 KB of URL the request does not come back as an error
// with a status: the fetch THROWS, before any HTTP status exists to inspect.
//
// Measured against the live database on 2026-08-31:
//
//     100 ids ->  3,822 chars -> 200 OK
//     300 ids -> 11,222 chars -> 200 OK
//     500 ids -> 18,622 chars -> fetch failed
//
// That is exactly what broke reordering on the 4,565-photo race album: the grid loads a window of
// ~500 photos, the reorder posted all ~500 ids, and the ownership pre-check blew the URL limit. The
// route then reported the thrown query as "One or more photo IDs do not belong to this album" —
// blaming the customer's data for our own failed request, on the one album big enough to hit it.
//
// 200 keeps the URL near 7.5 KB, less than half the distance to the cliff, so it stays safe if ids
// or column names ever get longer.
export const MAX_IDS_PER_QUERY = 200

/** Split ids into groups small enough that each `.in(...)` URL stays well inside the limit. */
export function idBatches<T>(ids: readonly T[], size: number = MAX_IDS_PER_QUERY): T[][] {
  if (size < 1) throw new Error('idBatches: size must be at least 1')
  const out: T[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}

/**
 * Does this list repeat an id? A duplicate is its own bug and needs its own message: a repeated id
 * makes a count come back SHORT (the database matches it once), which looks identical to "one of
 * these does not exist" and sends the reader looking for a missing photo that is not missing.
 */
export function firstDuplicate<T>(ids: readonly T[]): T | null {
  const seen = new Set<T>()
  for (const id of ids) {
    if (seen.has(id)) return id
    seen.add(id)
  }
  return null
}
