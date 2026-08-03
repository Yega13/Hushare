'use client'

import { useEffect, useRef, useState } from 'react'
import { Globe, Check, ChevronDown } from 'lucide-react'
import { useT } from '@/i18n/LocaleProvider'
import { LOCALES, LOCALE_LABELS, LOCALE_COOKIE, type Locale } from '@/i18n/config'
import LocaleFlag from '@/components/LocaleFlag'

// Custom (not native <select>) language dropdown for the footer. Sets the locale cookie and reloads
// so the whole server-rendered page re-renders in the chosen language. Opens upward since it lives
// at the very bottom of the page.
export default function LanguageSwitcher({ className }: { className?: string }) {
  const { locale } = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function choose(next: Locale) {
    setOpen(false)
    if (next === locale) return
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
    window.location.reload()
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className={className}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Language"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'transparent', border: 'none', color: 'inherit', font: 'inherit',
          cursor: 'pointer', padding: 0,
        }}
      >
        <Globe size={15} style={{ opacity: 0.7 }} aria-hidden="true" />
        <span>{LOCALE_LABELS[locale]}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          style={{ opacity: 0.6, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          style={{
            position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, zIndex: 60,
            listStyle: 'none', margin: 0, padding: 6, minWidth: 170,
            background: '#FFFFFF', border: '1px solid #E4DAC9', borderRadius: 12,
            boxShadow: '0 12px 32px rgba(99,8,38,0.16)',
          }}
        >
          {LOCALES.map((l) => {
            const active = l === locale
            return (
              <li key={l} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => choose(l)}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = '#FBF4E4' }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: active ? 'rgba(99,8,38,0.06)' : 'transparent',
                    color: '#2A211C', font: 'inherit', fontSize: 14, fontWeight: active ? 700 : 500,
                    textAlign: 'left',
                  }}
                >
                  <LocaleFlag locale={l} />
                  <span style={{ flex: 1 }}>{LOCALE_LABELS[l]}</span>
                  {active && <Check size={15} style={{ color: '#630826' }} aria-hidden="true" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
