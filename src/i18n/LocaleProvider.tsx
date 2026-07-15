'use client'

import { createContext, useContext, useMemo } from 'react'
import { interpolate, type Dictionary } from './get-dictionary'
import { DEFAULT_LOCALE, type Locale } from './config'

type TFn = (key: string, vars?: Record<string, string | number>) => string
type Ctx = { locale: Locale; t: TFn }

const LocaleContext = createContext<Ctx | null>(null)

// Provider is fed the ACTIVE locale + its (English-merged) dictionary from the server, so client
// components translate with no flash and no need to ship every language to the browser.
export function LocaleProvider({
  locale,
  dict,
  children,
}: {
  locale: Locale
  dict: Dictionary
  children: React.ReactNode
}) {
  const value = useMemo<Ctx>(
    () => ({ locale, t: (key, vars) => interpolate(dict[key] ?? key, vars) }),
    [locale, dict],
  )
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

// Safe outside a provider (falls back to the raw key) so a component can't crash for lacking one.
export function useT(): Ctx {
  return useContext(LocaleContext) ?? { locale: DEFAULT_LOCALE, t: (k) => k }
}
