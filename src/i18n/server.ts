import { cookies, headers } from 'next/headers'
import { LOCALE_COOKIE, normalizeLocale, type Locale } from './config'

// Resolve the request locale on the server: explicit cookie choice wins, else the browser's
// Accept-Language, else the default. Reading the cookie makes rendering per-request dynamic —
// which is inherent to cookie-based i18n (content varies by locale) and fine on Workers.
export async function getServerLocale(): Promise<Locale> {
  const cookieStore = await cookies()
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value
  if (fromCookie) return normalizeLocale(fromCookie)
  const h = await headers()
  return normalizeLocale(h.get('accept-language'))
}
