// Lightweight cookie+context i18n (no [lang] route restructuring — see the internationalization
// note in the PR). English is always the baked-in fallback, so a missing translation renders
// English, never a broken key or blank.

export const LOCALES = ['en', 'ru', 'hy'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_COOKIE = 'hushare_locale'

// Master switch for the user-facing LANGUAGE PICKER UI. The translations + provider stay fully
// wired (so nothing regresses and English renders as normal), but no switcher is shown until the
// bilingual rollout is finished and reviewed. Flip to true to reveal the pickers (footer + account).
export const LANGUAGE_UI_ENABLED = false

// Native language names for the switcher.
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ru: 'Русский',
  hy: 'Հայերեն',
}

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v)
}

// Accepts 'ru', 'ru-RU', 'hy-AM', 'en-US', etc. → the supported short code, else default.
export function normalizeLocale(v: string | null | undefined): Locale {
  if (!v) return DEFAULT_LOCALE
  const short = v.toLowerCase().split(/[-_,;]/)[0].trim()
  return isLocale(short) ? short : DEFAULT_LOCALE
}
