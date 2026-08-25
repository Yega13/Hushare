import { describe, it, expect } from 'vitest'
import {
  uploadCapsForTier, albumMediaCapForTier, albumMediaCapForAlbum, formatCapSize, tooLargeMessage,
  isAllowedImage, isAllowedVideo,
  FREE_VIDEO_BYTES, PRO_VIDEO_BYTES, STUDIO_VIDEO_BYTES,
  FREE_ALBUM_MEDIA, LEGACY_FREE_ALBUM_MEDIA,
} from '@/lib/media'
import * as mediaModule from '@/lib/media'
import { looksLikeStaleDeploy, looksLikeDomCorruption, isForeignError } from '@/lib/report-error'
import { validateCustomSlug } from '@/lib/custom-slug'

// Tier limits decide what a paying customer actually receives, and the classifiers decide what
// reaches the Errors tab. Both are places where a silent bug is invisible until it costs something.

describe('upload caps by tier', () => {
  it('gives each tier the video allowance it is sold', () => {
    expect(uploadCapsForTier('free').video).toBe(FREE_VIDEO_BYTES)
    expect(uploadCapsForTier('pro').video).toBe(PRO_VIDEO_BYTES)
    expect(uploadCapsForTier('studio').video).toBe(STUDIO_VIDEO_BYTES)
  })

  it('never lets a higher tier receive less than a lower one', () => {
    const free = uploadCapsForTier('free')
    const pro = uploadCapsForTier('pro')
    const studio = uploadCapsForTier('studio')
    expect(pro.image).toBeGreaterThanOrEqual(free.image)
    expect(pro.video).toBeGreaterThan(free.video)
    expect(studio.video).toBeGreaterThanOrEqual(pro.video)
    expect(albumMediaCapForTier('pro')).toBeGreaterThan(albumMediaCapForTier('free'))
    expect(albumMediaCapForTier('studio')).toBeGreaterThan(albumMediaCapForTier('pro'))
  })

  it('free video allowance fits a modern phone clip — raised deliberately from 50MB', () => {
    // This assertion used to pin the cap at 50MB so that anyone raising it would see why it was set
    // there. It worked: the reason turned out not to survive contact with the data. ~30s of 1080p is
    // 60-100MB, so 50MB did not limit "large" video — it refused video outright, and one iPhone user
    // was turned away 18 times in a single session by it.
    //
    // Raised to 200MB on 2026-08-25, with the cost concern answered a different way: photos and
    // videos draw on ONE shared per-album allowance, so an album full of video is an album that runs
    // out of items sooner. A generous per-file size costs nothing extra when the total is bounded.
    expect(FREE_VIDEO_BYTES).toBe(200 * 1024 * 1024)
    // Still below Pro, or the paid tier would not be buying anything.
    expect(FREE_VIDEO_BYTES).toBeLessThan(PRO_VIDEO_BYTES)
  })
})

describe('formatCapSize', () => {
  it('reads as a person would say it', () => {
    expect(formatCapSize(50 * 1024 * 1024)).toBe('50 MB')
    expect(formatCapSize(1024 * 1024 * 1024)).toBe('1 GB')
    expect(formatCapSize(4 * 1024 * 1024 * 1024)).toBe('4 GB')
  })

  it('never renders a gigabyte cap as four thousand megabytes', () => {
    // The reason this function exists: "4096 MB" does not read as a generous limit.
    expect(formatCapSize(STUDIO_VIDEO_BYTES)).not.toContain('4096')
  })
})

describe('accepted formats', () => {
  // These lists used to live only in lib/cloudflare/r2.ts, which imports the AWS SDK and so cannot
  // be imported by a browser at all. The client therefore never asked the question: it accepted
  // anything beginning "image/", ran the whole decode-compress-thumbnail pipeline, and learned at
  // presign that the server would not take it. A photographer lost that work on 113 MB TIFFs.
  // They now live in lib/media, which both sides import, and these tests pin the contract.
  it('accepts what the pipeline can actually produce', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']) {
      expect(isAllowedImage(t)).toBe(true)
    }
    for (const t of ['video/mp4', 'video/quicktime', 'video/webm']) {
      expect(isAllowedVideo(t)).toBe(true)
    }
  })

  it('refuses formats no browser can decode, so they are caught before the upload not after', () => {
    // TIFF is the one that cost a customer real time. DNG/BMP/SVG are the same class of mistake.
    for (const t of ['image/tiff', 'image/x-adobe-dng', 'image/bmp', 'image/svg+xml', '']) {
      expect(isAllowedImage(t)).toBe(false)
    }
  })

  it('is case-insensitive, because browsers are not consistent about it', () => {
    expect(isAllowedImage('IMAGE/JPEG')).toBe(true)
    expect(isAllowedVideo('VIDEO/MP4')).toBe(true)
  })

  it('never lets a video type pass as an image, or the reverse', () => {
    expect(isAllowedImage('video/mp4')).toBe(false)
    expect(isAllowedVideo('image/jpeg')).toBe(false)
  })
})

describe('tooLargeMessage', () => {
  // THE invariant. Three separate code paths decide "deliberate refusal" vs "something broke" by
  // testing this text with startsWith('File too large') / /^(File too large|Unsupported)/:
  // the network classifier, the batch reporter's level choice, and the adaptive video lane. Reword
  // the opening and all three flip at once, silently -- every refused file would land in the Errors
  // tab as a real failure and every oversized video would narrow the upload concurrency for
  // everyone else. Cheap to assert, expensive to discover in production.
  it('keeps the prefix the refusal classifiers match on', () => {
    for (const m of [tooLargeMessage('video', FREE_VIDEO_BYTES), tooLargeMessage('image', 25 * 1024 * 1024)]) {
      expect(m.startsWith('File too large')).toBe(true)
      expect(/^(File too large|Unsupported)/i.test(m)).toBe(true)
    }
  })

  it('states the cap and, for video, what to do about it', () => {
    const v = tooLargeMessage('video', FREE_VIDEO_BYTES)
    expect(v).toContain(formatCapSize(FREE_VIDEO_BYTES))
    expect(v).toMatch(/trim/i)          // a guest cannot upgrade someone else's album; trimming is their only route
    expect(tooLargeMessage('image', 25 * 1024 * 1024)).toContain('25 MB')
  })

  it('carries no per-file number, so /admin groups repeats into one row', () => {
    // Message text is the grouping key. A file's own size varies per upload and would shatter one
    // recurring problem into a column of one-count rows -- it rides in the report context instead.
    expect(tooLargeMessage('video', FREE_VIDEO_BYTES)).toBe(tooLargeMessage('video', FREE_VIDEO_BYTES))
    expect(tooLargeMessage('video', FREE_VIDEO_BYTES)).not.toBe(tooLargeMessage('video', PRO_VIDEO_BYTES))
  })
})

describe('stale-deploy detection', () => {
  it('recognises the chunk errors a deploy produces', () => {
    for (const m of [
      'ChunkLoadError: Loading chunk 42 failed',
      "Failed to load chunk /_next/static/chunks/abc.js from module 81276",
      'error loading dynamically imported module',
    ]) expect(looksLikeStaleDeploy(m)).toBe(true)
  })

  it('does not swallow ordinary failures', () => {
    for (const m of ['Failed to fetch', 'Network error during upload', 'File too large']) {
      expect(looksLikeStaleDeploy(m)).toBe(false)
    }
  })
})

describe('DOM-corruption detection', () => {
  it('recognises a DOM rewritten under React', () => {
    expect(looksLikeDomCorruption(
      "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.",
    )).toBe(true)
    expect(looksLikeDomCorruption("Failed to execute 'removeChild' on 'Node'")).toBe(true)
  })

  it('does not claim unrelated errors', () => {
    for (const m of ['Failed to fetch', 'ChunkLoadError: Loading chunk 3 failed', 'Upload stalled']) {
      expect(looksLikeDomCorruption(m)).toBe(false)
    }
  })
})

describe('foreign-error filtering', () => {
  it('drops code injected by browsers and in-app browsers', () => {
    expect(isForeignError('anything', 'chrome-extension://abc/x.js')).toBe(true)
    expect(isForeignError('Error invoking postMessage', 'iabjs://navigation_performance_logger_android')).toBe(true)
    expect(isForeignError('Script error.')).toBe(true)
    expect(isForeignError("Cannot redefine property: ethereum on #<Window>")).toBe(true)
  })

  it('KEEPS our own errors — dropping a real report is the worse mistake', () => {
    expect(isForeignError('Failed to fetch', 'https://hushare.space/_next/static/chunks/x.js')).toBe(false)
    expect(isForeignError('Failed to fetch (/api/upload/presign)')).toBe(false)
    expect(isForeignError('Upload stalled')).toBe(false)
  })

  it('does not let an album named after a crypto wallet silence its own errors', () => {
    // "Backpack" and "phantom" are plausible album titles, so the wallet rule needs a SECOND
    // signal (the name used as a property of the global object) before it filters anything.
    expect(isForeignError('Upload failed for album Backpack')).toBe(false)
    expect(isForeignError('phantom.jpg could not be read')).toBe(false)
  })
})

describe('custom slug validation', () => {
  it('accepts a normal custom URL', () => {
    expect(validateCustomSlug('anna-and-david').ok).toBe(true)
  })

  it('rejects reserved words that would shadow a real route', () => {
    // A custom slug of "login" or "pricing" would take over that page for everyone.
    for (const s of ['login', 'pricing', 'admin', 'api', 'account']) {
      expect(validateCustomSlug(s).ok).toBe(false)
    }
  })

  it('rejects characters that could break a PostgREST .or() filter', () => {
    // resolveAlbum interpolates the slug into a filter expression; these are the characters that
    // would let a value escape the intended condition.
    for (const s of ['a,b', 'a(b)', 'a"b', 'a\\b', 'a b', 'a/b']) {
      expect(validateCustomSlug(s).ok).toBe(false)
    }
  })

  it('rejects empty and over-long values', () => {
    expect(validateCustomSlug('').ok).toBe(false)
    expect(validateCustomSlug('a'.repeat(200)).ok).toBe(false)
  })
})

// ── Lowering the free allowance, without taking room from albums that already have it ────────────
//
// Raising a limit is safe; lowering one is not. Somewhere there is an album at 700 items whose owner
// arranged a wedding around it, and shrinking it retroactively would be indefensible whatever the
// pricing page now says. Five albums were already over 500 when this changed and the largest held
// 985, so this is not hypothetical.
describe('free album allowance and grandfathering', () => {
  const OLD = '2026-08-01T12:00:00Z'   // before the cutoff
  const NEW = '2026-08-26T12:00:00Z'   // after it

  it('gives new free albums the reduced allowance', () => {
    expect(albumMediaCapForAlbum('free', NEW)).toBe(FREE_ALBUM_MEDIA)
    expect(FREE_ALBUM_MEDIA).toBe(500)
  })

  it('leaves albums made before the change on the old allowance', () => {
    expect(albumMediaCapForAlbum('free', OLD)).toBe(LEGACY_FREE_ALBUM_MEDIA)
    expect(LEGACY_FREE_ALBUM_MEDIA).toBe(1000)
  })

  it('attaches the allowance to the ALBUM, not the owner', () => {
    // The same owner making a new album tomorrow gets today's allowance — that is what "created
    // before" means, and it is what was agreed.
    expect(albumMediaCapForAlbum('free', OLD)).toBeGreaterThan(albumMediaCapForAlbum('free', NEW))
  })

  it('never grandfathers a paid tier — their allowance was never reduced', () => {
    for (const when of [OLD, NEW]) {
      expect(albumMediaCapForAlbum('pro', when)).toBe(albumMediaCapForTier('pro'))
      expect(albumMediaCapForAlbum('studio', when)).toBe(albumMediaCapForTier('studio'))
    }
  })

  it('errs toward the larger allowance when the date is unreadable', () => {
    // The two ways of being wrong are not equal: too much room costs a little storage, too little
    // takes space away from something a person already built.
    expect(albumMediaCapForAlbum('free', null)).toBe(LEGACY_FREE_ALBUM_MEDIA)
    expect(albumMediaCapForAlbum('free', 'not a date')).toBe(LEGACY_FREE_ALBUM_MEDIA)
  })

  it('accepts an ordinary phone clip on the free plan', () => {
    // A 50MB cap did not refuse "large" video, it refused video: phone clips are 60-100MB, and one
    // iPhone user was turned away 18 times in a single session by it.
    const free = uploadCapsForTier('free')
    expect(free.video).toBeGreaterThanOrEqual(100 * 1024 * 1024)
    expect(free.video).toBeLessThanOrEqual(uploadCapsForTier('pro').video)
  })

  it('keeps photos and videos in ONE shared allowance', () => {
    // No separate video count exists, deliberately: video is 1.4% of the library and the most any
    // album has held is 22, so a second number would govern a case that has never happened.
    const media = mediaModule as Record<string, unknown>
    for (const key of Object.keys(media)) {
      expect(key, `${key} looks like a separate video-count cap`).not.toMatch(/VIDEO_COUNT|MAX_VIDEOS|VIDEO_LIMIT/)
    }
  })
})
