import { describe, it, expect } from 'vitest'
import { classifyReferrer, deviceFromUserAgent, localClock } from '@/lib/visitor-context'

// These three decide what every visitor chart says, and all three fail SILENTLY when wrong: a
// mis-classified referrer does not throw, it just moves a number into the wrong bucket and the
// dashboard looks entirely plausible while pointing the wrong way. That is the whole reason they are
// pure functions with tests rather than inline logic.

const SELF = 'hushare.space'

describe('referrer classification', () => {
  it('separates a QR scan from a typed URL, which referrers cannot', () => {
    // The important one for this product: both arrive with NO referrer, so without the marker on
    // the QR link the single biggest channel — a printed code at an event — is invisible.
    expect(classifyReferrer(null, SELF, 'qr').refClass).toBe('qr')
    expect(classifyReferrer(null, SELF, null).refClass).toBe('direct')
    expect(classifyReferrer('', SELF).refClass).toBe('direct')
  })

  it('recognises search engines, including regional ones', () => {
    for (const r of ['https://www.google.com/', 'https://news.google.com/x', 'https://yandex.ru/search', 'https://duckduckgo.com/', 'https://www.bing.com/search?q=a']) {
      expect(classifyReferrer(r, SELF).refClass, r).toBe('search')
    }
  })

  it('recognises social sources, including shorteners', () => {
    for (const r of ['https://instagram.com/p/1', 'https://l.facebook.com/', 'https://t.co/abc', 'https://x.com/i/web', 'https://www.tiktok.com/@a']) {
      expect(classifyReferrer(r, SELF).refClass, r).toBe('social')
    }
  })

  it('does not match a brand name buried inside another domain', () => {
    // 'mytiktok.com' and 'notgoogle.com' are not TikTok and not Google. Substring matching here
    // would quietly credit an unrelated site with traffic.
    expect(classifyReferrer('https://mytiktok.com/', SELF).refClass).toBe('other')
    expect(classifyReferrer('https://notgoogle.com/', SELF).refClass).toBe('other')
    expect(classifyReferrer('https://sex.com/', SELF).refClass).toBe('other')
  })

  it('counts our own pages as internal, not as a referral', () => {
    expect(classifyReferrer('https://hushare.space/pricing', SELF).refClass).toBe('internal')
    expect(classifyReferrer('https://www.hushare.space/', SELF).refClass).toBe('internal')
  })

  it('survives a malformed referrer instead of throwing into the request path', () => {
    expect(classifyReferrer('not a url', SELF).refClass).toBe('other')
    expect(classifyReferrer('://///', SELF).refClass).toBe('other')
  })

  it('strips www so one site is not counted as two rows', () => {
    expect(classifyReferrer('https://www.example.com/a', SELF).refHost).toBe('example.com')
  })
})

describe('device detection', () => {
  it('classifies real user agents', () => {
    expect(deviceFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('mobile')
    expect(deviceFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('tablet')
    expect(deviceFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120')).toBe('desktop')
    expect(deviceFromUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Mobile Safari')).toBe('mobile')
    // Android WITHOUT "Mobile" is the convention for tablets.
    expect(deviceFromUserAgent('Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Safari')).toBe('tablet')
  })

  it('separates bots, so crawlers do not inflate every visitor number', () => {
    for (const ua of ['Googlebot/2.1 (+http://www.google.com/bot.html)', 'facebookexternalhit/1.1', 'HeadlessChrome/120']) {
      expect(deviceFromUserAgent(ua), ua).toBe('bot')
    }
  })

  it('says unknown rather than guessing when there is no user agent', () => {
    expect(deviceFromUserAgent(null)).toBe('unknown')
    expect(deviceFromUserAgent('')).toBe('unknown')
  })
})

describe('visitor-local clock', () => {
  it('reports an hour in range for real zones', () => {
    for (const tz of ['Asia/Yerevan', 'America/Los_Angeles', 'UTC', 'Australia/Sydney']) {
      const { hour, weekday } = localClock(tz)
      expect(hour, tz).toBeGreaterThanOrEqual(0)
      // Never 24: 'numeric' with hour12:false renders midnight as 24 in some engines, which would
      // invent a 25th column in the heatmap.
      expect(hour, tz).toBeLessThanOrEqual(23)
      expect(weekday, tz).toBeGreaterThanOrEqual(0)
      expect(weekday, tz).toBeLessThanOrEqual(6)
    }
  })

  it('puts zones either side of the dateline in genuinely different places', () => {
    // The entire reason for bucketing on the visitor's clock rather than UTC.
    const a = localClock('Pacific/Kiritimati')   // UTC+14
    const b = localClock('Pacific/Midway')       // UTC-11
    expect(a.hour).not.toBe(b.hour)
  })

  it('returns -1 rather than a wrong hour when the zone is unusable', () => {
    // A hole is visible in a chart; a plausible wrong number is not.
    expect(localClock(null)).toEqual({ hour: -1, weekday: -1 })
    expect(localClock('Not/AZone')).toEqual({ hour: -1, weekday: -1 })
  })
})
