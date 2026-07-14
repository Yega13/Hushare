// Device-side memory of albums THIS browser owns, so an anonymous creator who closes the tab can
// still get back to owner (management) view instead of losing their album forever.
//
// The owner_token is the album's management credential — it already lives in the #owner= link the
// creator receives at creation. Persisting it here just means they don't lose access if they
// don't bookmark that exact URL. localStorage is per-origin, so only hushare.space JS can read it.
// Once the owner signs up and revisits a remembered link, the existing claim flow attaches the
// album to their account permanently (see claimAlbumIfNeeded), making this a soft bridge to a
// real account rather than a permanent secret store.

export type MyAlbum = { slug: string; token: string; title: string; savedAt: number }

const KEY = 'hushare.myAlbums'
const MAX = 60

export function getMyAlbums(): MyAlbum[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return (arr as MyAlbum[])
      .filter((a) => a && typeof a.slug === 'string' && typeof a.token === 'string')
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
  } catch {
    return []
  }
}

export function rememberOwnedAlbum(slug: string, token: string, title: string): void {
  if (!slug || !token) return
  try {
    const list = getMyAlbums().filter((a) => a.slug !== slug)
    list.unshift({ slug, token, title: (title || slug).slice(0, 120), savedAt: Date.now() })
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    /* localStorage unavailable / quota — non-fatal, the #owner= link still works */
  }
}

export function forgetAlbum(slug: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(getMyAlbums().filter((a) => a.slug !== slug)))
  } catch {
    /* ignore */
  }
}
