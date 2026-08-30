import { describe, it, expect, beforeAll } from 'vitest'
import { r2KeyFromUrl, collectDeletionTargets, type PhotoToDelete } from '@/lib/album-delete'
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

// WHICH FILES DOES DELETING AN ALBUM DESTROY?
//
// Asked directly, because "could a change of yours delete some user's photos?" is the question the
// owner actually worries about, and until now nothing in the suite could answer it: the decision
// was buried inside forty lines of paging and error handling, reachable only by mocking Supabase.
// collectDeletionTargets is that decision with the database taken away.
//
// Every case below is a way to destroy the wrong file. None of them throw when they are wrong —
// they return a plausible-looking key, and the file is gone before anyone notices.
describe('deleting an album destroys exactly its own files', () => {
  const HOST = 'https://videos.hushare.space'
  const r2Photo = (album: string, id: string): PhotoToDelete => ({
    storage_path: `albums/${album}/${id}.jpg`,
    storage_backend: 'r2',
    thumb_url: `${HOST}/thumbs/${album}/${id}.jpg`,
    poster_url: null,
    stream_uid: null,
  })
  const streamPhoto = (album: string, uid: string): PhotoToDelete => ({
    storage_path: null,
    storage_backend: 'stream',
    thumb_url: null,
    poster_url: `${HOST}/posters/${album}/${uid}.jpg`,
    stream_uid: uid,
  })

  it('collects an image original AND its thumbnail — both, or storage leaks forever', () => {
    const { r2Keys, streamUids } = collectDeletionTargets([r2Photo('A', 'p1')], null)
    expect([...r2Keys].sort()).toEqual(['albums/A/p1.jpg', 'thumbs/A/p1.jpg'])
    expect(streamUids.size, 'an R2 photo has no Cloudflare Stream video').toBe(0)
  })

  it('collects a video by its Stream uid and its poster, never a storage_path', () => {
    // A Stream video's bytes are at Cloudflare. If this ever read storage_path for one, it would
    // delete whatever else happened to be written at that key.
    const { r2Keys, streamUids } = collectDeletionTargets([streamPhoto('A', 'uid1')], null)
    expect([...streamUids]).toEqual(['uid1'])
    expect([...r2Keys]).toEqual(['posters/A/uid1.jpg'])
  })

  it('ignores a storage_path on a Stream row even when one is present', () => {
    // Mutation testing found this gap: the fixture above has storage_path null, so a bug that made
    // a video ALSO delete an R2 original had nothing to act on and the suite stayed green.
    //
    // No Stream row in production carries a storage_path today (checked 2026-08-30: 132 rows, 0
    // with one). Nothing in the schema forbids it though, so this pins the rule rather than the
    // current data: a video's bytes are at Cloudflare, and if a future change starts writing a
    // path on these rows, deleting it must be a decision someone made rather than a side effect.
    const hybrid: PhotoToDelete = {
      storage_path: 'albums/OTHER/not-ours.mp4',
      storage_backend: 'stream',
      thumb_url: null,
      poster_url: `${HOST}/posters/A/uid1.jpg`,
      stream_uid: 'uid1',
    }
    const { r2Keys, streamUids } = collectDeletionTargets([hybrid], null)
    expect([...streamUids]).toEqual(['uid1'])
    expect([...r2Keys], 'only the poster — never the storage_path of a Stream row').toEqual(['posters/A/uid1.jpg'])
  })

  it('takes nothing from a URL it cannot parse', () => {
    // The wrong-file case. A URL on someone else's host must yield NO key rather than a guess:
    // orphaning a file costs a fraction of a cent a month, deleting the wrong one is unrecoverable.
    const foreign: PhotoToDelete = {
      storage_path: null, storage_backend: 'r2', stream_uid: null, poster_url: null,
      thumb_url: 'https://evil.example.com/thumbs/B/p9.jpg',
    }
    expect(collectDeletionTargets([foreign], null).r2Keys.size).toBe(0)
  })

  it('never collects a key belonging to a different album', () => {
    // The scoping fear, stated as an assertion. This function only ever sees rows the caller
    // selected, so what it guarantees is that it invents nothing: given album A's rows, every key
    // it returns is derived from those rows and mentions A.
    const { r2Keys } = collectDeletionTargets(
      [r2Photo('A', 'p1'), r2Photo('A', 'p2'), streamPhoto('A', 'uid1')], null)
    expect(r2Keys.size).toBeGreaterThan(0)
    for (const key of r2Keys) {
      expect(key, `${key} does not belong to album A`).toMatch(/\/A\//)
    }
  })

  it('collects an uploaded background, and is not fooled by a built-in theme name', () => {
    // A background is an asset of the ALBUM, not of any photo, so nothing else would ever collect
    // it — and the built-in themes are names rather than files, so treating one as a URL would be
    // a delete aimed at nothing.
    expect([...collectDeletionTargets([], `image:${HOST}/backgrounds/A/bg.jpg`).r2Keys])
      .toEqual(['backgrounds/A/bg.jpg'])
    for (const theme of ['sunset', 'none', null, 'image:not-a-url']) {
      expect(collectDeletionTargets([], theme).r2Keys.size, `${theme} is not a file`).toBe(0)
    }
  })

  it('deduplicates, so a repeated key is not deleted twice', () => {
    const { r2Keys } = collectDeletionTargets([r2Photo('A', 'p1'), r2Photo('A', 'p1')], null)
    expect(r2Keys.size).toBe(2)
  })

  it('survives rows with nothing in them rather than collecting a broken key', () => {
    const empty: PhotoToDelete = {
      storage_path: null, storage_backend: 'r2', thumb_url: null, poster_url: null, stream_uid: null,
    }
    const { r2Keys, streamUids } = collectDeletionTargets([empty], null)
    expect(r2Keys.size).toBe(0)
    expect(streamUids.size).toBe(0)
  })
})
