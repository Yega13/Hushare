import { describe, it, expect } from 'vitest'
import {
  videoCaps, clipTooLong, videoBudgetExceeded, videoBudgetLeft, formatClipLimit,
  videoAlbumFullMessage, type VideoCaps,
} from '../src/lib/album-entitlements'
import { FREE_ALBUM_LIMIT, PRO_ALBUM_LIMIT, STUDIO_ALBUM_LIMIT } from '../src/lib/media'

describe('videoCaps — the agreed ladder', () => {
  it('gives each plan at least as much as the one below it, on BOTH axes', () => {
    // A higher plan giving less than a lower one is incoherent whatever the cost maths says, and
    // it would be invisible on the pricing page until a customer noticed they had paid for less.
    const free = videoCaps('free')
    const pro = videoCaps('pro')
    const max = videoCaps('studio')

    expect(pro.maxClipSeconds).toBeGreaterThanOrEqual(free.maxClipSeconds)
    expect(pro.maxTotalSeconds).toBeGreaterThanOrEqual(free.maxTotalSeconds)
    expect(max.maxClipSeconds).toBeGreaterThanOrEqual(pro.maxClipSeconds)
    expect(max.maxTotalSeconds).toBeGreaterThanOrEqual(pro.maxTotalSeconds)
  })

  it('is exactly what was agreed', () => {
    expect(videoCaps('free')).toEqual({ maxClipSeconds: 60, maxTotalSeconds: 600 })
    expect(videoCaps('pro')).toEqual({ maxClipSeconds: 120, maxTotalSeconds: 1200 })
    expect(videoCaps('studio')).toEqual({ maxClipSeconds: 600, maxTotalSeconds: 3000 })
  })

  it('never lets one clip consume the whole allowance in a single upload', () => {
    // The clip limit and the budget do different jobs. If one clip could fill the album, the
    // budget would stop being a budget and become a second way of saying "one video".
    for (const tier of ['free', 'pro', 'studio'] as const) {
      const c = videoCaps(tier)
      expect(c.maxTotalSeconds, tier).toBeGreaterThan(c.maxClipSeconds)
    }
  })

  it('leaves the busiest album that actually exists inside the FREE budget', () => {
    // Measured across all 97 live albums: the most video any album holds is 7.2 minutes, average
    // 0.39. A budget below this would refuse real behaviour to save nothing.
    expect(videoCaps('free').maxTotalSeconds).toBeGreaterThan(7.2 * 60)
  })

  it('treats an album with no account as free, not as something tighter', () => {
    expect(videoCaps(null)).toEqual(videoCaps('free'))
    expect(videoCaps(undefined)).toEqual(videoCaps('free'))
  })

  it('states the worst case per ACCOUNT, which is how the shared quota is actually spent', () => {
    // Cloudflare Stream storage is a PURCHASED ceiling — 1,000 minutes per $5 unit — and running
    // out blocks video for every album, not just the greedy one. So what matters is how much of
    // that shared ceiling one account can take: albums-per-plan x the per-album budget.
    const accountMinutes = (c: VideoCaps, albums: number) => (c.maxTotalSeconds / 60) * albums

    expect(accountMinutes(videoCaps('free'), FREE_ALBUM_LIMIT)).toBe(30)
    expect(accountMinutes(videoCaps('pro'), PRO_ALBUM_LIMIT)).toBe(300)
    expect(accountMinutes(videoCaps('studio'), STUDIO_ALBUM_LIMIT)).toBe(2000)

    // At $0.005 per stored minute per month, the THEORETICAL worst case against what each plan
    // earns. These are written down rather than asserted comfortable, because two of them are not:
    //
    //   Free  30 min  = $0.15  against $0
    //   Pro  300 min  = $1.50  against $4     ok
    //   Max 2000 min  = $10.00 against $10    the entire plan, before photos or anything else
    //
    // Max is not survivable at its own maximum. It survives only because nobody fills 40 albums
    // with video — the whole platform holds 37 minutes today. That is a bet, not a design, and it
    // is the reason capping is a holding position rather than an answer: the multiplier is the
    // album limit, and no per-album number fixes it while video costs what it costs on Stream.
    expect(accountMinutes(videoCaps('free'), FREE_ALBUM_LIMIT) * 0.005).toBeLessThan(0.20)
    expect(accountMinutes(videoCaps('pro'), PRO_ALBUM_LIMIT) * 0.005).toBeLessThan(4)
    expect(accountMinutes(videoCaps('studio'), STUDIO_ALBUM_LIMIT) * 0.005).toBe(10)

    // What a REALISTIC heavy account costs — five active albums, all full of video. This is the
    // one that has to stay inside revenue, and does.
    expect(accountMinutes(videoCaps('studio'), 5) * 0.005).toBeLessThan(2)
  })
})

describe('clipTooLong', () => {
  const caps = videoCaps('pro')   // 120 s

  it('refuses a clip over the limit', () => {
    expect(clipTooLong(600, caps)).toBe(true)
    expect(clipTooLong(120.6, caps)).toBe(false)   // inside the one-second slack
    expect(clipTooLong(121.2, caps)).toBe(true)    // a fraction past it still counts
    expect(clipTooLong(121.5, caps)).toBe(true)
  })

  it('allows a clip exactly at the limit', () => {
    // An off-by-one here refuses precisely the clip somebody trimmed to fit.
    expect(clipTooLong(120, caps)).toBe(false)
    expect(clipTooLong(119.9, caps)).toBe(false)
  })

  it('accepts every free-tier clip that has ever been uploaded', () => {
    // The longest is 54s. A 30s cap would have refused 13% of them; 60s refuses none.
    expect(clipTooLong(54, videoCaps('free'))).toBe(false)
    expect(clipTooLong(60.02, videoCaps('free'))).toBe(false)
    expect(clipTooLong(75, videoCaps('free'))).toBe(true)
  })

  it('NEVER refuses a clip it could not measure', () => {
    // 25 of 155 real videos have no duration; one album is 15 for 15. Turning "we could not read
    // this" into "your video is too long" is wrong and unfixable by the person holding the phone.
    for (const bad of [null, undefined, 0, -5, NaN, Infinity, 'abc', {}, []]) {
      expect(clipTooLong(bad, caps), String(bad)).toBe(false)
    }
  })
})

describe('videoBudgetExceeded', () => {
  const caps = videoCaps('free')   // 60s clips, 600s budget

  it('lets an album spend its allowance however it likes', () => {
    // THE POINT OF A BUDGET over a count: ten one-minute clips or forty fifteen-second ones cost
    // the same, so both are allowed. A count cap would have refused the second.
    expect(videoBudgetExceeded(9 * 60, 60, caps)).toBe(false)     // 10th minute-long clip
    expect(videoBudgetExceeded(39 * 15, 15, caps)).toBe(false)    // 40th 15-second clip
  })

  it('refuses the clip that would take it past the budget', () => {
    expect(videoBudgetExceeded(595, 30, caps)).toBe(true)
    expect(videoBudgetExceeded(570, 30, caps)).toBe(false)        // lands exactly on 600
  })

  it('is not full one second early or one second late', () => {
    expect(videoBudgetExceeded(599, 1, caps)).toBe(false)
    expect(videoBudgetExceeded(599, 2, caps)).toBe(true)
    expect(videoBudgetExceeded(600, 0, caps)).toBe(true)
  })

  it('an empty album can always take a clip', () => {
    expect(videoBudgetExceeded(0, 60, caps)).toBe(false)
  })

  it('lets an unmeasured clip through while there is room, and refuses it when there is not', () => {
    // Errs in the album's favour below the budget — the same direction clipTooLong errs. Once the
    // allowance is demonstrably spent, an unmeasurable clip is refused rather than being an
    // unlimited hole.
    expect(videoBudgetExceeded(100, undefined, caps)).toBe(false)
    expect(videoBudgetExceeded(100, null, caps)).toBe(false)
    expect(videoBudgetExceeded(600, undefined, caps)).toBe(true)
    expect(videoBudgetExceeded(700, undefined, caps)).toBe(true)
  })

  it('treats nonsense usage as zero rather than locking an album out', () => {
    expect(videoBudgetExceeded(NaN, 60, caps)).toBe(false)
    expect(videoBudgetExceeded(-100, 60, caps)).toBe(false)
  })
})

describe('videoBudgetLeft', () => {
  const caps = videoCaps('free')

  it('reports what is left, and never a negative', () => {
    expect(videoBudgetLeft(0, caps)).toBe(600)
    expect(videoBudgetLeft(240, caps)).toBe(360)
    expect(videoBudgetLeft(600, caps)).toBe(0)
    expect(videoBudgetLeft(900, caps)).toBe(0)
  })
})

describe('the refusal message tells them what to do about it', () => {
  const caps = videoCaps('free')

  it('names the remaining time when some is left', () => {
    const msg = videoAlbumFullMessage(caps, 570)
    expect(msg).toContain('30 seconds')
    expect(msg).toContain('Delete a video')
  })

  it('does not offer a remainder when there is none', () => {
    const msg = videoAlbumFullMessage(caps, 600)
    expect(msg).toContain('10 minutes')
    expect(msg).not.toContain('left')
  })
})

describe('formatClipLimit', () => {
  it('says minutes when the limit is whole minutes', () => {
    expect(formatClipLimit(120)).toBe('2 minutes')
    expect(formatClipLimit(600)).toBe('10 minutes')
    expect(formatClipLimit(60)).toBe('1 minute')
  })

  it('says seconds below a minute', () => {
    expect(formatClipLimit(30)).toBe('30 seconds')
    expect(formatClipLimit(45)).toBe('45 seconds')
  })

  it('formats every real limit the way a customer would read it', () => {
    expect(formatClipLimit(videoCaps('free').maxClipSeconds)).toBe('1 minute')
    expect(formatClipLimit(videoCaps('free').maxTotalSeconds)).toBe('10 minutes')
    expect(formatClipLimit(videoCaps('pro').maxTotalSeconds)).toBe('20 minutes')
    expect(formatClipLimit(videoCaps('studio').maxTotalSeconds)).toBe('50 minutes')
  })
})
