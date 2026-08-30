import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { r2KeyFromUrl, collectDeletionTargets, albumAssetKeys, ALBUM_ASSET_COLUMNS, type PhotoToDelete } from '@/lib/album-delete'
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

// EVERY FILE AN ALBUM OWNS, NOT JUST THE ONES SOMEONE REMEMBERED.
//
// Deleting an album was told about its photos and its background only. Its logo, its header image
// and its sponsor marks were never collected — the album row went and those files stayed in the
// bucket with nothing left pointing at them, billed forever, unfindable. A header image is not a
// rare extra; any album with one had this.
//
// The same missing fact ran the other way in api/admin/storage-audit, which built its "referenced"
// set from photos plus logo_url and so reported every live background, header and sponsor mark as
// an orphan — offered up for deletion, in a tool whose whole purpose is deciding what to delete.
//
// One function now answers "which files does this album own", and both sides call it.
describe('an album owns more than its photos', () => {
  const H = 'https://videos.hushare.space'

  it('collects the uploaded background, logo, header and every sponsor mark', () => {
    const keys = albumAssetKeys({
      background_theme: `image:${H}/backgrounds/A/bg.jpg`,
      logo_url: `${H}/logos/A/logo.jpg`,
      header_image: `${H}/headers/A/head.webp`,
      sponsor_logos: [{ id: 's1', url: `${H}/sponsors/A/one.png`, name: null },
                      { id: 's2', url: `${H}/sponsors/A/two.png`, name: 'Two' }],
    })
    expect(keys.sort()).toEqual([
      'backgrounds/A/bg.jpg', 'headers/A/head.webp', 'logos/A/logo.jpg',
      'sponsors/A/one.png', 'sponsors/A/two.png',
    ].sort())
  })

  it('knows a built-in background is not a file', () => {
    // The same column holds '#ffe476' and 'stock:pexels-20954747'. Neither is in the bucket, and
    // treating one as a URL is a delete aimed at nothing — or, in the audit, a phantom reference.
    for (const theme of ['#ffe476', 'stock:pexels-20954747', 'none', null, 'image:not-a-url']) {
      expect(albumAssetKeys({ background_theme: theme }), `${theme} is not a file`).toEqual([])
    }
  })

  it('survives a sponsor_logos column holding something unexpected', () => {
    // jsonb: whatever was written is what comes back. A malformed row must not throw halfway
    // through deleting an album, nor halfway through scanning the bucket.
    for (const junk of [null, undefined, '[]', 42, [null], [{ name: 'no url' }], [{ url: 123 }]]) {
      expect(() => albumAssetKeys({ sponsor_logos: junk })).not.toThrow()
    }
    expect(albumAssetKeys({ sponsor_logos: [{ name: 'no url' }] })).toEqual([])
  })

  it('takes nothing from an album with no design assets at all', () => {
    expect(albumAssetKeys({})).toEqual([])
  })

  it('names every prefix the upload routes actually mint', () => {
    // backgrounds/, headers/, logos/ and sponsors/ are written by four separate upload routes. A
    // fifth prefix added later with no line here is a file class that deletion silently leaks and
    // the audit silently slanders — which is exactly how this bug happened.
    const keys = albumAssetKeys({
      background_theme: `image:${H}/backgrounds/A/b.jpg`,
      logo_url: `${H}/logos/A/l.jpg`,
      header_image: `${H}/headers/A/h.jpg`,
      sponsor_logos: [{ url: `${H}/sponsors/A/s.png` }],
    })
    for (const prefix of ['backgrounds/', 'headers/', 'logos/', 'sponsors/']) {
      expect(keys.some((k) => k.startsWith(prefix)), `${prefix} is not collected`).toBe(true)
    }
  })
})

// THE OWNER-ACCESS ALLOWLIST DROPS UNKNOWN COLUMNS SILENTLY.
//
// verifyOwnerViaCookie filters requested columns against ALLOWED_EXTRA_COLUMNS — correct, it stops
// caller-supplied names reaching .select(). But the filter DISCARDS what it does not recognise
// rather than complaining, so a typo in a column name compiles, runs, returns an album with that
// field undefined, and quietly stops deleting whichever asset it named.
//
// That is precisely the bug this file was just written for: album deletion leaving logos, headers
// and sponsor marks in the bucket forever. Getting it back through a misspelling would be silent in
// exactly the same way.
describe('deletion can actually request every column it needs', () => {
  const access = readFileSync(join(process.cwd(), 'src', 'lib', 'album-owner-access.ts'), 'utf8')
  const allowlist = /const ALLOWED_EXTRA_COLUMNS = new Set\(\[([\s\S]*?)\]\)/.exec(access)

  it('finds the allowlist it is checking', () => {
    expect(allowlist, 'ALLOWED_EXTRA_COLUMNS must stay a literal Set').not.toBeNull()
  })

  for (const column of ['background_theme', 'logo_url', 'header_image', 'sponsor_logos']) {
    it(`${column} is allowed through to the delete route`, () => {
      expect(
        (allowlist as RegExpExecArray)[1].includes(`'${column}'`),
        `api/album/delete asks for ${column} so it can remove that file. The allowlist drops ` +
          `unknown names without a word, so leaving it out means the file is never deleted and ` +
          `nothing anywhere says so.`,
      ).toBe(true)
    })
  }

  it('ALBUM_ASSET_COLUMNS names only real album columns', () => {
    // The other three delete callers select this string straight against Postgres, where an unknown
    // column IS an error — but api/album/delete routes it through the allowlist above, where it is
    // silently dropped instead. Checking against the schema catches both cases.
    //
    // Parsed by splitting, not by regex: the first version used one built from a template string,
    // the escapes were mangled before it reached disk, and it reported every column as missing
    // including `id`. That is rule 24, hit while writing the test for rule 13.
    const schema = readFileSync(join(process.cwd(), 'schema.sql'), 'utf8')
    const from = schema.indexOf('create table if not exists public.albums (')
    expect(from, 'albums table not found in schema.sql').toBeGreaterThan(-1)
    const body = schema.slice(from, schema.indexOf(String.fromCharCode(10) + ');', from))
    const declared = new Set(
      body.split(String.fromCharCode(10)).map((l) => l.trim().split(' ')[0]),
    )
    for (const col of ALBUM_ASSET_COLUMNS.split(',').map((c) => c.trim())) {
      expect(declared.has(col), `${col} is not a column on albums`).toBe(true)
    }
  })
})
