import type { SupabaseClient } from '@supabase/supabase-js'

// Which album an error report came from, and who owns it.
//
// Written ONCE and used by both the admin page's server render and the live-stats poll that
// replaces those rows every few seconds. Enriching in only one of them is worse than enriching
// in neither: the column fills on load and then empties itself five seconds later, which reads
// as data being lost rather than never fetched (rule 13, in its most visible form).
//
// A report identifies an ALBUM, never a guest. Guests are not signed in and nothing about them
// is stored; the useful answer to "who had this error" is which album broke and who to contact
// about it.

export type AlbumOwner = { title: string; slug: string; email: string }

// Owner emails, remembered for the life of the isolate. The dashboard polls every five seconds
// and the SAME few owners reappear on every tick — uncached, one open admin tab could issue
// hundreds of GoTrue lookups a minute to redraw a column that never changes. An email that
// changes later is stale only until the isolate recycles, which is the right trade for a label.
const EMAIL_CACHE = new Map<string, string>()

type Rowish = { album_id: string | null }

export async function attachAlbumOwners<T extends Rowish>(
  admin: SupabaseClient,
  rows: T[],
  emailById: Map<string, string> = new Map(),
): Promise<Array<T & { album: AlbumOwner | null | undefined }>> {
  const ids = [...new Set(rows.map((r) => r.album_id).filter((x): x is string => !!x))]
  if (ids.length === 0) return rows.map((r) => ({ ...r, album: null }))

  const { data, error } = await admin
    .from('albums')
    .select('id, title, slug, custom_slug, user_id')
    .in('id', ids)

  // UNDEFINED, not null. The table reads null as "this album is gone" and prints so; a lookup
  // that merely failed must not make that claim about a live album (rule 20). Undefined means
  // "not resolved", the row still renders, and the next poll tries again. It must never take
  // down the error table itself — that table is what an operator opens when things are wrong.
  if (error || !data) return rows.map((r) => ({ ...r, album: undefined }))

  // Owner emails for ids the caller's map does not already hold. The admin page arrives with a
  // full user map and needs none of this; the live-stats poll holds no map at all, and looking up
  // the handful of owners whose albums actually errored is far cheaper than listing every user
  // every few seconds. Bounded by the number of DISTINCT errored albums, which is small by
  // definition — an admin screen full of errored albums has a bigger problem than this query.
  const albums = data as Array<Record<string, unknown>>
  const needed = [...new Set(
    albums.map((a) => a.user_id as string | null).filter((u): u is string => !!u && !emailById.has(u)),
  )]
  const fetched = new Map<string, string>()
  for (const id of needed) { const hit = EMAIL_CACHE.get(id); if (hit) fetched.set(id, hit) }
  await Promise.all(needed.filter((id) => !fetched.has(id)).map(async (id) => {
    try {
      const { data: u } = await admin.auth.admin.getUserById(id)
      if (u?.user?.email) { fetched.set(id, u.user.email); EMAIL_CACHE.set(id, u.user.email) }
    } catch { /* leave unresolved — labelled below, never guessed */ }
  }))

  const byId = new Map<string, AlbumOwner>()
  for (const a of albums) {
    const userId = a.user_id as string | null
    byId.set(a.id as string, {
      title: (a.title as string) || '(untitled)',
      slug: (a.custom_slug as string) || (a.slug as string),
      // A guest-created album genuinely has no owner. That is a real state and is labelled as
      // one, rather than rendering blank next to rows where the lookup simply failed.
      email: userId ? (emailById.get(userId) ?? fetched.get(userId) ?? '(unknown user)') : '(no account)',
    })
  }
  return rows.map((r) => ({ ...r, album: r.album_id ? (byId.get(r.album_id) ?? null) : null }))
}
