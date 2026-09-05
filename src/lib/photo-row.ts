import type { MediaDisplayFilter, MediaType, StorageBackend } from '@/types'
import { DISPLAY_FILTERS, MEDIA_TYPES, STORAGE_BACKENDS, isOneOf } from '@/lib/db-unions'

// WHERE A photos ROW BECOMES A Photo.
//
// Three columns on `photos` are `text` with a CHECK constraint -- media_type, storage_backend and
// display_filter -- so the generated Database type can only call them `string`, while the Photo type
// the rest of the product consumes declares the unions. For as long as the two hot photo reads ended
// in `.returns<Photo[]>()` and `as unknown as Photo[]`, that gap was papered over by a cast, and the
// cast also erased every OTHER check on the 23-column select: a review proved a misspelled column
// compiled clean. This function is what lets those casts go.
//
// It is GENERIC over the row rather than typed against a column list. The return type is derived
// from whatever the query actually selected, and the compiler checks THAT against Photo at the call
// site -- so a selected column whose type disagrees with Photo is a compile error at the boundary,
// with no second copy of the 23 names for rule 13 to worry about.
//
// WHICH WAY EACH FIELD ERRS (rule 19), and why they differ:
//
//   media_type       CHECK is exactly image|video, so an unknown value cannot come from the database
//                    today. If one ever does, the row is DROPPED and reported: every consumer
//                    branches on `=== 'video'`, so an unknown would silently render as an image with
//                    a video's URLs -- a broken tile nobody can explain.
//   storage_backend  CHECK still permits 'supabase' from before media moved to R2 (zero rows, no
//                    write path). DROPPED and reported, for the same reason: `=== 'stream'` and
//                    `=== 'r2'` are both used as the discriminator, and an unknown backend has no
//                    consistent meaning to either. lib/db-unions records this as a deliberate
//                    narrowing so the schema test does not flag it.
//   display_filter   Cosmetic. An unknown filter is COERCED TO NULL -- rendered unfiltered -- because
//                    dropping a guest's photograph over a colour grade would be absurd.
//
// The report goes through a callback so this module stays a pure function with no admin-client
// import: it is tested with fixture rows and no mocks.

type ConstrainedIn = {
  id: string
  media_type: string
  storage_backend: string
  display_filter: string | null
}

type Narrowed<R extends ConstrainedIn> = Omit<R, 'media_type' | 'storage_backend' | 'display_filter'> & {
  media_type: MediaType
  storage_backend: StorageBackend
  display_filter: MediaDisplayFilter | null
}

export type DroppedPhoto = { id: string; column: 'media_type' | 'storage_backend'; value: string }

export function narrowPhotoRows<R extends ConstrainedIn>(
  rows: readonly R[],
  onDropped: (dropped: DroppedPhoto) => void,
): Narrowed<R>[] {
  const out: Narrowed<R>[] = []
  for (const row of rows) {
    if (!isOneOf(MEDIA_TYPES, row.media_type)) {
      onDropped({ id: row.id, column: 'media_type', value: row.media_type })
      continue
    }
    if (!isOneOf(STORAGE_BACKENDS, row.storage_backend)) {
      onDropped({ id: row.id, column: 'storage_backend', value: row.storage_backend })
      continue
    }
    const display_filter = isOneOf(DISPLAY_FILTERS, row.display_filter) ? row.display_filter : null
    // The three narrowed fields are re-stated; everything else passes through untouched, which is
    // what keeps this cheap enough to run on a 5,000-photo grid: three tuple lookups per row.
    out.push({ ...row, media_type: row.media_type, storage_backend: row.storage_backend, display_filter })
  }
  return out
}
