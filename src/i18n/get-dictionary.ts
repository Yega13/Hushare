import { en, type DictKey } from './dictionaries/en'
import { ru } from './dictionaries/ru'
import { hy } from './dictionaries/hy'
import type { Locale } from './config'

export type Dictionary = Record<string, string>

const OVERRIDES: Record<Locale, Partial<Record<DictKey, string>>> = { en: {}, ru, hy }

// English fallback is baked in by spreading the locale over the full English base, so the
// returned dictionary always has every key and callers never need their own fallback logic.
export function getDictionary(locale: Locale): Dictionary {
  return { ...en, ...OVERRIDES[locale] }
}

// {name}-style interpolation. Unknown vars are left as-is so a typo is visible, not swallowed.
export function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`))
}
