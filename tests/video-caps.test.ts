import { describe, it, expect } from 'vitest'
import {
  videoCaps, clipTooLong, videoAlbumFull, formatClipLimit, type VideoCaps,
} from '../src/lib/album-entitlements'
import { FREE_ALBUM_LIMIT, PRO_ALBUM_LIMIT, STUDIO_ALBUM_LIMIT } from '../src/lib/media'

describe('videoCaps — the agreed ladder', () => {
  it('gives each paid plan at least as much as the one below it, on BOTH axes', () => {
    // The rule the owner set, in his own words: a higher plan giving less than a lower one is
    // incoherent whatever the cost maths says. A single number regressing here would be invisible
    // on the pricing page until a customer noticed they had paid for less.
    const free = videoCaps('free')
    const pro = videoCaps('pro')
    const max = videoCaps('studio')

    expect(pro.maxClipSeconds).toBeGreaterThanOrEqual(free.maxClipSeconds)
    expect(pro.maxVideos).toBeGreaterThanOrEqual(free.maxVideos)
    expect(max.maxClipSeconds).toBeGreaterThanOrEqual(pro.maxClipSeconds)
    expect(max.maxVideos).toBeGreaterThanOrEqual(pro.maxVideos)
  })

  it('is exactly what was agreed', () => {
    expect(videoCaps('free')).toEqual({ maxClipSeconds: 30, maxVideos: 20 })
    expect(videoCaps('pro')).toEqual({ maxClipSeconds: 120, maxVideos: 30 })
    expect(videoCaps('studio')).toEqual({ maxClipSeconds: 600, maxVideos: 40 })
  })

  it('treats an album with no account as free, not as something tighter', () => {
    // Its 250-item cap already stops it long before video cost matters, and a guest album is the
    // first thing anybody tries.
    expect(videoCaps(null)).toEqual(videoCaps('free'))
    expect(videoCaps(undefined)).toEqual(videoCaps('free'))
  })

  it('states the worst case per ACCOUNT, which is how plans are actually billed', () => {
    // The earlier version of this test claimed to bound cost and did not: it multiplied one
    // album, while a plan buys many, and its thresholds left room for 13x the Pro caps before
    // failing. Named honestly now, and asserting the real arithmetic.
    //
    // Cloudflare Stream: $0.005 per stored minute per month.
    const perAccount = (c: VideoCaps, albums: number) => (c.maxVideos * c.maxClipSeconds / 60) * 0.005 * albums
    const free = perAccount(videoCaps('free'), FREE_ALBUM_LIMIT)
    const pro = perAccount(videoCaps('pro'), PRO_ALBUM_LIMIT)
    const max = perAccount(videoCaps('studio'), STUDIO_ALBUM_LIMIT)

    expect(free).toBeCloseTo(0.15, 2)   // 3 albums x 10 min
    expect(pro).toBeCloseTo(4.50, 2)    // 15 albums x 60 min
    expect(max).toBeCloseTo(80.00, 2)   // 40 albums x 400 min

    // AND THE POINT: at the theoretical maximum both paid plans cost more than they earn. That is
    // survivable only because nobody fills 15 or 40 albums with maximum-length video — the whole
    // platform holds 37 minutes today. It is written down as a number rather than a comment so
    // that raising a cap makes the gap move in front of somebody.
    expect(pro).toBeGreaterThan(4)      // $4/mo plan
    expect(max).toBeGreaterThan(10)     // $10/mo plan
    expect(free).toBeLessThan(0.20)     // free earns nothing, so it must stay near nothing
  })
})

describe('clipTooLong', () => {
  const caps = videoCaps('pro')   // 120 s

  it('refuses a clip over the limit', () => {
    expect(clipTooLong(600, caps)).toBe(true)
    expect(clipTooLong(120.6, caps)).toBe(false)   // inside the one-second slack
    expect(clipTooLong(121.5, caps)).toBe(true)    // past it
    // A FRACTION past the slack still counts. This is the case that catches a rounding version of
    // this check: round(121.2) is 121, which would read as inside the slack when it is not.
    expect(clipTooLong(121.2, caps)).toBe(true)
    expect(clipTooLong(125, caps)).toBe(true)
  })

  it('allows a clip exactly at the limit', () => {
    // An off-by-one here refuses precisely the clip somebody trimmed to fit, which is the most
    // annoying possible failure: they did what they were told and it still said no.
    expect(clipTooLong(120, caps)).toBe(false)
    expect(clipTooLong(119.9, caps)).toBe(false)
  })

  it('forgives a fraction over, because browsers report duration as a float', () => {
    // A 30-second clip commonly measures 30.02. Refusing that is refusing a correct video over a
    // rounding artefact.
    expect(clipTooLong(30.02, videoCaps('free'))).toBe(false)
    expect(clipTooLong(31, videoCaps('free'))).toBe(false)
    expect(clipTooLong(45, videoCaps('free'))).toBe(true)
  })

  it('NEVER refuses a clip it could not measure', () => {
    // The duration comes from the browser and a failed metadata read is common on older phones.
    // Turning "we could not read this" into "your video is too long" is both wrong and something
    // the person cannot act on. The upload path bounds unmeasured clips separately.
    for (const bad of [null, undefined, 0, -5, NaN, Infinity, 'abc', {}, []]) {
      expect(clipTooLong(bad, caps), String(bad)).toBe(false)
    }
  })
})

describe('videoAlbumFull', () => {
  const caps = videoCaps('pro')   // 30 videos

  it('is full AT the limit, not one past it', () => {
    expect(videoAlbumFull(29, caps)).toBe(false)
    expect(videoAlbumFull(30, caps)).toBe(true)
    expect(videoAlbumFull(31, caps)).toBe(true)
  })

  it('an empty album is never full', () => {
    expect(videoAlbumFull(0, caps)).toBe(false)
  })
})

describe('formatClipLimit — the number in the refusal must read like the number advertised', () => {
  it('says minutes when the limit is whole minutes', () => {
    expect(formatClipLimit(120)).toBe('2 minutes')
    expect(formatClipLimit(600)).toBe('10 minutes')
    expect(formatClipLimit(60)).toBe('1 minute')
  })

  it('says seconds below a minute', () => {
    expect(formatClipLimit(30)).toBe('30 seconds')
    expect(formatClipLimit(45)).toBe('45 seconds')
  })

  it('formats every real cap the way the pricing page writes it', () => {
    expect(formatClipLimit(videoCaps('free').maxClipSeconds)).toBe('30 seconds')
    expect(formatClipLimit(videoCaps('pro').maxClipSeconds)).toBe('2 minutes')
    expect(formatClipLimit(videoCaps('studio').maxClipSeconds)).toBe('10 minutes')
  })
})
