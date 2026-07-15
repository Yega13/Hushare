'use client'

import { useT } from '@/i18n/LocaleProvider'
import { LOCALES, LOCALE_LABELS, LOCALE_COOKIE, type Locale } from '@/i18n/config'

// Sets the locale cookie and reloads so the whole (server-rendered) page re-renders in the chosen
// language. A reload is simplest and correct — server components read the cookie on the next render.
export default function LanguageSwitcher({ className }: { className?: string }) {
  const { locale } = useT()

  function choose(next: Locale) {
    if (next === locale) return
    // 1 year, site-wide. Not HttpOnly — the client sets it; the server reads it for rendering.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
    window.location.reload()
  }

  return (
    <label className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span className="sr-only">Language</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.7 }}>
        <circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 0 20 15.3 15.3 0 0 1 0-20z" />
      </svg>
      <select
        value={locale}
        onChange={(e) => choose(e.target.value as Locale)}
        aria-label="Language"
        style={{ background: 'transparent', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer', outline: 'none' }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>{LOCALE_LABELS[l]}</option>
        ))}
      </select>
    </label>
  )
}
