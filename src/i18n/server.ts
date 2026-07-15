import { cookies } from 'next/headers'
import { LOCALE_COOKIE, normalizeLocale, type Locale } from './config'

// English is ALWAYS the default. The language only changes when the user EXPLICITLY picks one
// (which sets the cookie). We intentionally do NOT auto-detect from Accept-Language — a Russian-
// or Armenian-locale browser was landing on a translated site unexpectedly; English-first is the
// deliberate choice, with manual switching via the account settings / footer.
export async function getServerLocale(): Promise<Locale> {
  const cookieStore = await cookies()
  return normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value)
}
