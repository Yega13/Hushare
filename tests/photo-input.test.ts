import { describe, it, expect } from 'vitest'
import { validatePhoto, hasTraversal, r2UrlPrefix, type PhotoInput } from '@/lib/photo-input'

// THE BOUNDARY BETWEEN A GUEST AND AN ALBUM'S STORAGE.
//
// api/album/photos/create accepts rows describing files already written to R2 or Stream. Nothing
// here has seen the bytes — the client says "there is a photo at this key, with this thumbnail". So
// this function is the whole boundary, and it sat inside a 645-line route handler with no test.
//
// The thumb_url rule is the sharp one. Before it, a guest could read any public album's photo list
// (it returns the album id and every photo's public URL), then POST rows with a fresh storage_path
// — so they insert — but a thumb_url pointing at a REAL photo's file. The owner sees junk, deletes
// it, and the delete path feeds thumb_url straight into r2KeyFromUrl and removes that key from R2.
// The owner's own moderation click destroys their originals. No account, no owner link, no bytes
// uploaded, aimed at the exact moment somebody is most likely to click delete.
const ALBUM = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const OTHER = 'ffffffff-9999-8888-7777-666666666666'
const HOST = 'videos.hushare.space'

const ok = (over: Partial<PhotoInput> = {}): PhotoInput => ({
  storage_backend: 'r2',
  media_type: 'image',
  storage_path: `albums/${ALBUM}/p1.jpg`,
  url: `https://${HOST}/albums/${ALBUM}/p1.jpg`,
  thumb_url: `https://${HOST}/thumbs/${ALBUM}/p1.jpg`,
  ...over,
})
const check = (p: PhotoInput) => validatePhoto(p, 0, ALBUM, HOST)

describe('a valid upload is accepted', () => {
  it('accepts a well-formed R2 image', () => {
    expect(check(ok())).toBeNull()
  })

  it('accepts a Stream video', () => {
    expect(check({
      storage_backend: 'stream',
      media_type: 'video',
      stream_uid: 'a'.repeat(32),
      poster_url: `https://${HOST}/thumbs/${ALBUM}/poster.jpg`,
      duration_seconds: 16,
    })).toBeNull()
  })

  it('accepts a photo with no thumbnail at all', () => {
    expect(check(ok({ thumb_url: null }))).toBeNull()
    expect(check(ok({ thumb_url: undefined }))).toBeNull()
  })
})

describe('a thumbnail can only ever point into thumbs/', () => {
  it('REFUSES a thumb_url aimed at a real photo — the delete-my-originals attack', () => {
    // The whole exploit in one line: a row that inserts cleanly, carrying a thumbnail that is
    // actually somebody else's original. Deleting the junk row deletes that original.
    expect(check(ok({ thumb_url: `https://${HOST}/albums/${ALBUM}/victim.jpg` }))).toMatch(/thumb_url/)
  })

  it('REFUSES a thumbnail belonging to a different album', () => {
    expect(check(ok({ thumb_url: `https://${HOST}/thumbs/${OTHER}/x.jpg` }))).toMatch(/thumb_url/)
  })

  it('refuses a poster aimed at a real photo, for the same reason', () => {
    expect(check({
      storage_backend: 'stream',
      media_type: 'video',
      stream_uid: 'b'.repeat(32),
      poster_url: `https://${HOST}/albums/${ALBUM}/victim.jpg`,
    })).toMatch(/poster_url/)
  })

  it('refuses a thumbnail on another host entirely', () => {
    expect(check(ok({ thumb_url: `https://evil.example.com/thumbs/${ALBUM}/x.jpg` }))).toMatch(/thumb_url/)
  })

  it('refuses a lookalike host that merely starts the same', () => {
    expect(check(ok({ thumb_url: `https://${HOST}.evil.com/thumbs/${ALBUM}/x.jpg` }))).toMatch(/thumb_url/)
  })
})

describe('a photo can only be written into its own album', () => {
  it('refuses a storage_path under another album', () => {
    expect(check(ok({ storage_path: `albums/${OTHER}/p1.jpg` }))).toMatch(/storage_path/)
  })

  it('refuses a url under another album', () => {
    expect(check(ok({ url: `https://${HOST}/albums/${OTHER}/p1.jpg` }))).toMatch(/url/)
  })

  it('is not fooled by an album id that merely starts the same', () => {
    // The prefix ends in a slash for this reason: without it, appending characters to the id lands
    // in a different album whose id shares a prefix.
    expect(check(ok({ storage_path: `albums/${ALBUM}extra/p1.jpg` }))).toMatch(/storage_path/)
  })
})

describe('path traversal cannot escape the album prefix', () => {
  it('catches the shapes an attacker actually sends', () => {
    for (const evil of [
      '..', 'a/../b', 'a%2e%2eb', 'a%2e.b', 'a.%2eb', 'a%2fb', 'a%5cb', 'a%25b',
      'a' + String.fromCharCode(92) + 'b', 'a' + String.fromCharCode(0) + 'b', 'a%00b',
    ]) {
      expect(hasTraversal(evil), `${JSON.stringify(evil)} must be rejected`).toBe(true)
    }
  })

  it('leaves ordinary keys alone', () => {
    for (const fine of ['albums/x/p1.jpg', 'thumbs/x/a-b_c.1.jpg', 'p.jpg']) {
      expect(hasTraversal(fine), `${fine} is a normal key`).toBe(false)
    }
  })

  it('refuses a storage_path with traversal even under the right prefix', () => {
    expect(check(ok({ storage_path: `albums/${ALBUM}/../../etc/x` }))).toMatch(/storage_path/)
  })
})

describe('the backend and media type must agree', () => {
  it('refuses a video claiming the R2 backend, and an image claiming Stream', () => {
    expect(check(ok({ media_type: 'video' }))).toMatch(/r2 backend/)
    expect(check({ storage_backend: 'stream', media_type: 'image' })).toMatch(/stream backend/)
  })

  it('refuses anything that is not one of the two known values', () => {
    expect(check(ok({ storage_backend: 'ftp' }))).toMatch(/storage_backend/)
    expect(check(ok({ media_type: 'audio' }))).toMatch(/media_type/)
    expect(check(ok({ storage_backend: 42 }))).toMatch(/storage_backend/)
  })
})

describe('fields that arrive as JSON are treated as unknown', () => {
  it('refuses a numeric storage_path rather than trusting the type', () => {
    // These arrive from the network. A `string` annotation on a value that came as a number is a
    // lie the compiler believes, so every check here is a runtime typeof.
    expect(check(ok({ storage_path: 12345 }))).toMatch(/storage_path/)
    expect(check(ok({ url: { toString: () => 'x' } }))).toMatch(/url/)
    expect(check(ok({ thumb_url: 999 }))).toMatch(/thumb_url/)
  })

  it('refuses an absurdly long path or url', () => {
    expect(check(ok({ storage_path: `albums/${ALBUM}/` + 'a'.repeat(600) }))).toMatch(/storage_path/)
    expect(check(ok({ url: `https://${HOST}/albums/${ALBUM}/` + 'a'.repeat(2100) }))).toMatch(/url/)
  })

  it('refuses a malformed stream uid', () => {
    for (const uid of ['short', 'A'.repeat(32), 'g'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), 42]) {
      expect(
        check({ storage_backend: 'stream', media_type: 'video', stream_uid: uid }),
        String(uid),
      ).toMatch(/stream_uid/)
    }
  })

  it('refuses a nonsensical duration', () => {
    for (const d of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '16']) {
      expect(
        check({
          storage_backend: 'stream',
          media_type: 'video',
          stream_uid: 'c'.repeat(32),
          duration_seconds: d,
        }),
        String(d),
      ).toMatch(/duration_seconds/)
    }
  })
})

describe('caption and author limits match what gets stored', () => {
  it('measures the trimmed value, as photo/settings does', () => {
    // A 30-character caption with a trailing space was accepted when edited and refused when
    // uploaded — the same caption, two answers, depending on which screen you were on.
    expect(check(ok({ caption: 'a'.repeat(30) + '  ' }))).toBeNull()
    expect(check(ok({ caption: 'a'.repeat(31) }))).toMatch(/caption/)
    expect(check(ok({ author_name: 'b'.repeat(16) + ' ' }))).toBeNull()
    expect(check(ok({ author_name: 'b'.repeat(17) }))).toMatch(/author_name/)
  })
})

describe('the prefix helper builds what the checks compare against', () => {
  it('produces the exact public prefix, with the trailing slash', () => {
    expect(r2UrlPrefix(HOST, ALBUM, 'albums')).toBe(`https://${HOST}/albums/${ALBUM}/`)
    expect(r2UrlPrefix(HOST, ALBUM, 'thumbs')).toBe(`https://${HOST}/thumbs/${ALBUM}/`)
  })
})


describe('a URL that resolves to somebody else’s file cannot be stored', () => {
  // THE ATTACK, closed at the writing end.
  //
  // r2KeyFromUrl strips a query string, so `<victim>.jpg?x` names the victim's object while being
  // a different STRING. A guest could post rows whose thumb_url was exactly that: they render
  // broken, which is what makes an owner select and delete them, and the delete then destroyed the
  // real photo's thumbnail. Nothing regenerates a thumbnail server-side, and there is no backup.
  it('rejects a query string or a fragment in any stored URL', () => {
    expect(hasTraversal('https://h/thumbs/a/real.jpg?x'), 'query string').toBe(true)
    expect(hasTraversal('https://h/thumbs/a/real.jpg#x'), 'fragment').toBe(true)
    expect(hasTraversal('https://h/thumbs/a/real.jpg?'), 'bare question mark').toBe(true)
  })

  it('still accepts an ordinary key', () => {
    // The guard must not start refusing real uploads — every key we mint is <uuid>.<ext>.
    expect(hasTraversal('https://h/thumbs/a/9f8e7d6c-1234-4a5b-8c9d-000000000000.jpg')).toBe(false)
  })
})
