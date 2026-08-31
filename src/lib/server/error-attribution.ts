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

type Rowish = { album_id: string | null }

export async function attachAlbumOwners<T extends Rowish>(
  admin: SupabaseClient,
  rows: T[],
  emailById: Map<string, string> = new Map(),
): Promise<Array<T & { album: AlbumOwner | null }>> {
  const ids = [...new Set(rows.map((r) => r.album_id).filter((x): x is string => !!x))]
  if (ids.length === 0) return rows.map((r) => ({ ...r, album: null }))

  const { data, error } = await admin
    .from('albums')
    .select('id, title, slug, custom_slug, user_id')
    .in('id', ids)

  // A failed lookup yields null attribution — the table then prints "album deleted" for rows that
  // do have an album, which is wrong but harmless and self-corrects on the next poll. It must
  // never take down the error table itself: the table is what an operator opens when something is
  // already going wrong.
  if (error || !data) return rows.map((r) => ({ ...r, album: null }))

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
  await Promise.all(needed.map(async (id) => {
    try {
      const { data: u } = await admin.auth.admin.getUserById(id)
      if (u?.user?.email) fetched.set(id, u.user.email)
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
