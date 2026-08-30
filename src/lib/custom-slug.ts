// URL SEGMENTS THE APP ITSELF OWNS.
//
// A custom album URL is a PAID feature, and a static route always beats /[slug] in Next.js. So a
// name in this list that is missing produces the worst kind of failure: the owner sets it, it
// saves, nothing errors — and the URL quietly resolves to one of our own pages instead of their
// album. They put it on a wedding sign before anyone finds out.
//
// Six real pages were missing on 2026-08-30 — event-photo-sharing, qr-code-photo-album,
// shared-photo-album, statement, wedding-photo-sharing and wall — because this list is maintained
// by hand and pages are added without thinking about it. Nobody had claimed one yet.
//
// A Worker cannot read the filesystem, so this stays a literal set. What stops it drifting again is
// tests/limits-and-classifiers.test.ts, which walks src/app and fails if any real route is missing
// here. Adding a page without reserving its name now breaks the build rather than a customer.
//
// Names beyond the real routes are deliberate: reserved words for pages that do not exist yet
// (billing, dashboard, checkout), and shapes people assume exist (faq, help, contact, signin).
export const RESERVED_SLUGS = new Set([
  'about', 'account', 'admin', 'api', 'app', 'auth',
  'billing', 'c', 'callback', 'card-editor', 'checkout', 'collabs', 'contact',
  'cron', 'dashboard', 'download', 'faq', 'favicon', 'health', 'help', 'home', 'hushare',
  'index', 'legal', 'login', 'logout', 'manifest',
  'me', 'oauth', 'pricing', 'privacy', 'report', 'robots',
  'settings', 'signin', 'signout', 'signup', 'sitemap', 'support',
  'terms', 'tos', 'upload', 'webhook', 'webhooks',
  // The six that were missing, plus the marketing landing pages they belong with.
  'event-photo-sharing', 'qr-code-photo-album', 'shared-photo-album',
  'statement', 'wedding-photo-sharing', 'wall',
])

export type SlugValidationResult =
  | { ok: true; slug: string }
  | { ok: false; reason: string }

export function validateCustomSlug(input: unknown): SlugValidationResult {
  if (typeof input !== 'string') return { ok: false, reason: 'Must be text' }
  const slug = input.trim().toLowerCase()

  if (slug.length < 4) return { ok: false, reason: 'At least 4 characters' }
  if (slug.length > 40) return { ok: false, reason: 'At most 40 characters' }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { ok: false, reason: 'Only letters, numbers, and hyphens' }
  }
  if (slug.startsWith('-') || slug.endsWith('-')) {
    return { ok: false, reason: 'Cannot start or end with a hyphen' }
  }
  if (slug.includes('--')) {
    return { ok: false, reason: 'No consecutive hyphens' }
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, reason: 'This name is reserved' }
  }

  return { ok: true, slug }
}
