import { describe, it, expect } from 'vitest'
import {
  uploadCapsForTier, albumMediaCapForTier, formatCapSize,
  FREE_VIDEO_BYTES, PRO_VIDEO_BYTES, STUDIO_VIDEO_BYTES,
} from '@/lib/media'
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

  it('free video allowance is smaller than one modern phone clip — documented, not accidental', () => {
    // ~30s of 1080p is 60-100MB. This assertion exists so that if the free cap is ever raised,
    // whoever does it sees WHY it was 50MB and that events are the case it constrains.
    expect(FREE_VIDEO_BYTES).toBe(50 * 1024 * 1024)
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
