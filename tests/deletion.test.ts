import { describe, it, expect, beforeAll } from 'vitest'
import { r2KeyFromUrl } from '@/lib/album-delete'
import { r2PublicUrl } from '@/lib/cloudflare/r2'

// r2KeyFromUrl decides WHICH FILE GETS DELETED. Everything about album and photo deletion
// eventually funnels through it: it takes a public URL off a database row and returns the storage
// key to remove from the bucket.
//
// Two ways it can be wrong, and both are permanent because there are no backups and no undo:
//   - returns a key it should not  -> the wrong file is destroyed
//   - returns null when it should not -> the file is orphaned, billed forever, and stays publicly
//     reachable by anyone holding the link, which contradicts the privacy policy
//
// It is also the ONLY pure function in the deletion path. Everything else needs a live database,
// so this is where a unit test can actually help; the rest belongs in an integration suite.

const HOST = 'videos.hushare.space'

beforeAll(() => {
  process.env.R2_PUBLIC_HOST = HOST
})

describe('r2KeyFromUrl — which file deletion targets', () => {
  it('round-trips with r2PublicUrl for every key shape the app mints', () => {
    // If these two ever disagree, deletion silently stops finding files and every delete orphans.
    for (const key of [
      'albums/aaaa-bbbb/photo.jpg',
      'thumbs/aaaa-bbbb/photo.jpg',
      'logos/aaaa-bbbb/logo.png',
      'headers/aaaa-bbbb/header.jpg',
      'backgrounds/aaaa-bbbb/bg.jpg',
      'sponsors/aaaa-bbbb/sponsor.png',
    ]) {
      expect(r2KeyFromUrl(r2PublicUrl(key))).toBe(key)
    }
  })

  it('REFUSES a URL on another host — the wrong-file-deleted case', () => {
    // A row whose URL points elsewhere must never yield a key, because that key would be deleted
    // from OUR bucket. "evil.example/albums/x/y.jpg" must not delete albums/x/y.jpg.
    expect(r2KeyFromUrl('https://evil.example/albums/aaaa/photo.jpg')).toBeNull()
    expect(r2KeyFromUrl(`https://not-${HOST}/albums/aaaa/photo.jpg`)).toBeNull()
  })

  it('refuses a lookalike host that merely starts the same', () => {
    expect(r2KeyFromUrl(`https://${HOST}.evil.example/albums/a/b.jpg`)).toBeNull()
  })

  it('refuses http where the app only ever mints https', () => {
    expect(r2KeyFromUrl(`http://${HOST}/albums/a/b.jpg`)).toBeNull()
  })

  it('strips a query string so a cache-busted URL still resolves to its key', () => {
    // A row carrying ?v=2 must still delete the object, not orphan it.
    expect(r2KeyFromUrl(`https://${HOST}/albums/a/b.jpg?v=2`)).toBe('albums/a/b.jpg')
  })

  it('returns null for empty and null input rather than an empty key', () => {
    // An empty key would mean "delete the bucket root" to a careless caller.
    expect(r2KeyFromUrl(null)).toBeNull()
    expect(r2KeyFromUrl('')).toBeNull()
    expect(r2KeyFromUrl(`https://${HOST}/`)).toBeNull()
  })

  it('is not confused by a key that contains the host name', () => {
    const key = `albums/aaaa/${HOST}.jpg`
    expect(r2KeyFromUrl(r2PublicUrl(key))).toBe(key)
  })

  it('tolerates R2_PUBLIC_HOST written with a scheme or trailing slash', () => {
    // Both spellings appear in real config; deletion must not start orphaning because of one.
    const url = `https://${HOST}/albums/a/b.jpg`
    for (const spelling of [`https://${HOST}`, `${HOST}/`, `https://${HOST}/`]) {
      process.env.R2_PUBLIC_HOST = spelling
      expect(r2KeyFromUrl(url)).toBe('albums/a/b.jpg')
    }
    process.env.R2_PUBLIC_HOST = HOST
  })

  it('fails SAFE when R2_PUBLIC_HOST is missing — orphan, never wrong-delete', () => {
    // Losing a file is recoverable-ish; deleting the wrong one is not. With no host configured
    // there is no way to know whose URL this is, so it must refuse.
    const saved = process.env.R2_PUBLIC_HOST
    delete process.env.R2_PUBLIC_HOST
    expect(r2KeyFromUrl(`https://${HOST}/albums/a/b.jpg`)).toBeNull()
    process.env.R2_PUBLIC_HOST = saved
  })

  it('does not let a traversal-looking URL escape its prefix', () => {
    // The key is used verbatim against the bucket; ".." has no meaning to R2 as a path operator,
    // but this pins that nothing tries to normalise it into a different object.
    const k = r2KeyFromUrl(`https://${HOST}/albums/aaaa/../bbbb/x.jpg`)
    expect(k).toBe('albums/aaaa/../bbbb/x.jpg')
    expect(k).not.toBe('albums/bbbb/x.jpg')
  })
})
