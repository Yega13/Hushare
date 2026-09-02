import { describe, it, expect } from 'vitest'
import {
  videoCaps, videoBudgetExceeded, videoBudgetLeft, formatClipLimit,
  videoAlbumFullMessage, type VideoCaps,
} from '../src/lib/album-entitlements'
import { FREE_ALBUM_LIMIT, PRO_ALBUM_LIMIT, STUDIO_ALBUM_LIMIT } from '../src/lib/media'

describe('videoCaps — the agreed ladder', () => {
  it('gives each plan at least as much as the one below it', () => {
    // A higher plan giving less than a lower one is incoherent whatever the cost maths says, and
    // it would be invisible on the pricing page until a customer noticed they had paid for less.
    const free = videoCaps('free')
    const pro = videoCaps('pro')
    const max = videoCaps('studio')

    expect(pro.maxTotalSeconds).toBeGreaterThanOrEqual(free.maxTotalSeconds)
    expect(max.maxTotalSeconds).toBeGreaterThanOrEqual(pro.maxTotalSeconds)
  })

  it('is exactly what was agreed — minutes per album, and NOTHING else', () => {
    // toEqual, not toMatchObject, on purpose: it fails if a per-clip cap is ever added back. The
    // limit is one pool of minutes the owner spends however they like — one twenty-minute video or
    // twenty one-minute ones. A second limit beside it is the thing that was removed.
    expect(videoCaps('free')).toEqual({ maxTotalSeconds: 600 })
    expect(videoCaps('pro')).toEqual({ maxTotalSeconds: 1200 })
    expect(videoCaps('studio')).toEqual({ maxTotalSeconds: 3000 })
  })

  it('lets ONE clip use the entire allowance, which is the whole point', () => {
    // The case the removed cap refused: an empty album must accept a single video exactly as long
    // as its budget. Pro is 20 minutes, so one 20-minute video has to be allowed.
    for (const tier of ['free', 'pro', 'studio'] as const) {
      const c = videoCaps(tier)
      expect(videoBudgetExceeded(0, c.maxTotalSeconds, c), tier).toBe(false)
      // And one second more than the budget is still refused.
      expect(videoBudgetExceeded(0, c.maxTotalSeconds + 1, c), tier).toBe(true)
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
    // Errs in the album's favour below the budget. Once the
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
    expect(formatClipLimit(60)).toBe('1 minute')
    expect(formatClipLimit(videoCaps('free').maxTotalSeconds)).toBe('10 minutes')
    expect(formatClipLimit(videoCaps('pro').maxTotalSeconds)).toBe('20 minutes')
    expect(formatClipLimit(videoCaps('studio').maxTotalSeconds)).toBe('50 minutes')
  })
})
