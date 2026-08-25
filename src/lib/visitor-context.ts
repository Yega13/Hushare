import { getCloudflareContext } from '@opennextjs/cloudflare'
import { headers } from 'next/headers'

// Who is on the site, where from, and when — in THEIR time.
//
// None of this is new data. Every request that reaches this Worker already arrives carrying the
// visitor's country, city, region and IANA timezone, resolved by Cloudflare at the edge before our
// code runs. It has been thrown away on every request since the product launched: `album_viewed` was
// recorded with an album id and nothing else, so "where are our users" and "when do they use this"
// were unanswerable despite the answers being handed to us for free.
//
// WHAT IS DELIBERATELY NOT COLLECTED. No IP address, ever — not raw, not hashed. No identifier that
// survives a page load, so nobody can be followed from one visit to the next. Nothing here can
// single out a person: "Yerevan, Sunday, 21:00, from Instagram, on a phone" describes thousands of
// people and is useful precisely because it does. That is a deliberate ceiling, not an oversight.
//
// The timezone field is the valuable one. It means "when do people use Hushare" is answered on the
// VISITOR'S clock rather than the server's — an album opened at 9pm local reads as 9pm whether the
// guest is in Yerevan or Los Angeles. Bucketing that by UTC would smear every evening across two
// different days and make the answer worse the more countries the product reaches.

export type VisitorContext = {
  country: string
  city: string
  region: string
  refClass: RefClass
  refHost: string
  device: Device
  /** Hour 0–23 on the VISITOR'S clock, not the server's. -1 when the timezone is unusable. */
  hour: number
  /** 0 = Sunday … 6 = Saturday, on the visitor's clock. -1 when unknown. */
  weekday: number
}

export type Device = 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown'
export type RefClass = 'direct' | 'search' | 'social' | 'qr' | 'internal' | 'other'

const SEARCH = /(^|\.)(google|bing|yahoo|duckduckgo|yandex|baidu|ecosia|brave|qwant)\./i
const SOCIAL = /(^|\.)(instagram|facebook|fb|messenger|twitter|x|t|tiktok|linkedin|pinterest|reddit|snapchat|whatsapp|telegram|vk|ok)\.(com|me|co|ru|net)$/i

// Order matters: bots first, or every headless crawler counts as a desktop visitor and quietly
// inflates every number on the page.
export function deviceFromUserAgent(ua: string | null | undefined): Device {
  if (!ua) return 'unknown'
  if (/bot|crawler|spider|crawling|headless|preview|facebookexternalhit|slurp|bingpreview/i.test(ua)) return 'bot'
  if (/ipad|tablet|playbook|silk|(android(?!.*mobi))/i.test(ua)) return 'tablet'
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile'
  return 'desktop'
}

// A printed QR code and a typed URL are indistinguishable in a referrer — both arrive with none.
// For a product whose whole distribution is a code on a sign at an event, telling them apart is one
// of the more valuable things here, so the QR links carry their own marker and it wins over
// everything else.
export function classifyReferrer(referrer: string | null | undefined, selfHost: string, source?: string | null): { refClass: RefClass; refHost: string } {
  if (source === 'qr') return { refClass: 'qr', refHost: 'qr' }
  if (!referrer) return { refClass: 'direct', refHost: '' }
  let host: string
  try {
    host = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return { refClass: 'other', refHost: '' }
  }
  if (!host) return { refClass: 'direct', refHost: '' }
  if (selfHost && host === selfHost.replace(/^www\./, '').toLowerCase()) return { refClass: 'internal', refHost: host }
  if (SEARCH.test(`${host}.`)) return { refClass: 'search', refHost: host }
  if (SOCIAL.test(host)) return { refClass: 'social', refHost: host }
  return { refClass: 'other', refHost: host }
}

// Local wall-clock hour and weekday for an IANA zone. Returns -1s rather than guessing when the zone
// is missing or nonsense — a wrong hour is worse than a hole, because a hole is visible.
export function localClock(timezone: string | null | undefined): { hour: number; weekday: number } {
  if (!timezone) return { hour: -1, weekday: -1 }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      // h23 explicitly: 'numeric' with hour12:false renders midnight as 24 in some implementations,
      // which would silently create a 25th hour in the chart.
      hourCycle: 'h23',
      hour: '2-digit',
      weekday: 'short',
    }).formatToParts(new Date())
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN)
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const weekday = names.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '')
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return { hour: -1, weekday }
    return { hour, weekday }
  } catch {
    return { hour: -1, weekday: -1 }
  }
}

type Cf = { country?: unknown; city?: unknown; region?: unknown; timezone?: unknown }

const clean = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 64) : '')

/**
 * Build the visitor context for the CURRENT request. Never throws — telemetry must not be able to
 * break a page — and returns empty strings rather than partial nonsense when the platform does not
 * supply something (local `next dev`, for one, has no `cf` at all).
 */
export async function getVisitorContext(source?: string | null): Promise<VisitorContext> {
  const empty: VisitorContext = {
    country: '', city: '', region: '', refClass: 'direct', refHost: '', device: 'unknown', hour: -1, weekday: -1,
  }
  try {
    const cf = ((await getCloudflareContext({ async: true }))?.cf ?? {}) as Cf
    const h = await headers()
    const selfHost = (h.get('host') ?? '').split(':')[0]
    const { refClass, refHost } = classifyReferrer(h.get('referer'), selfHost, source)
    const { hour, weekday } = localClock(typeof cf.timezone === 'string' ? cf.timezone : null)
    return {
      country: clean(cf.country),
      city: clean(cf.city),
      region: clean(cf.region),
      refClass,
      refHost,
      device: deviceFromUserAgent(h.get('user-agent')),
      hour,
      weekday,
    }
  } catch {
    return empty
  }
}
