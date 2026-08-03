'use client'

import { useT } from '@/i18n/LocaleProvider'
import { LOCALES, LOCALE_COOKIE, LOCALE_LABELS, type Locale } from '@/i18n/config'
import LocaleFlag from '@/components/LocaleFlag'

// Flag + native-name buttons for the account settings page. Sets the locale cookie and reloads so
// server-rendered content re-renders in the chosen language. Flags are inline SVG (see LocaleFlag).
export default function LanguageSwitcherFlags() {
  const { locale } = useT()

  function choose(next: Locale) {
    if (next === locale) return
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
    window.location.reload()
  }

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {LOCALES.map((l) => {
        const active = l === locale
        return (
          <button
            key={l}
            type="button"
            onClick={() => choose(l)}
            aria-pressed={active}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 16px', borderRadius: 12,
              border: `1.5px solid ${active ? '#630826' : '#DDD5C5'}`,
              background: active ? 'rgba(99,8,38,0.06)' : '#FFFFFF',
              color: '#2A211C', cursor: 'pointer',
              fontWeight: active ? 700 : 500, fontSize: 15,
            }}
          >
            <LocaleFlag locale={l} />
            {LOCALE_LABELS[l]}
          </button>
        )
      })}
    </div>
  )
}
