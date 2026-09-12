// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'
import { localeCookie, switchLocale, LOCALE_COOKIE_MAX_AGE_SECONDS } from '@/lib/switch-locale'
import { LOCALE_COOKIE } from '@/i18n/config'

// CHOOSING A LANGUAGE. The cookie the server reads, for a year, across the whole site -- and the
// reload that makes the page re-render in it, which must come AFTER the cookie or the page reloads
// in the old language.

describe('choosing a language', () => {
  it('writes the cookie the server reads, for a year, site-wide, same-site', () => {
    expect(localeCookie('hy')).toBe(`${LOCALE_COOKIE}=hy; path=/; max-age=31536000; SameSite=Lax`)
    expect(LOCALE_COOKIE_MAX_AGE_SECONDS).toBe(31_536_000)
  })

  it('sets the cookie and THEN reloads, in that order', () => {
    const events: string[] = []
    const doc = {
      get cookie() { return '' },
      set cookie(v: string) { events.push(`cookie:${v}`) },
    }
    switchLocale('ru', doc, () => { events.push('reload') })
    expect(events).toEqual([`cookie:${localeCookie('ru')}`, 'reload'])
  })

  it('really lands in document.cookie when nothing is injected', () => {
    switchLocale('hy', undefined, () => {})
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=hy`)
  })

  it('both switchers go through it, and neither writes the cookie or reloads by itself', () => {
    for (const f of ['LanguageSwitcher.tsx', 'LanguageSwitcherFlags.tsx']) {
      const text = stripJsComments(readFileSync(join(process.cwd(), 'src', 'components', f), 'utf8'))
      expect(text, f).toMatch(/import \{ switchLocale \} from '@\/lib\/switch-locale'/)
      expect(text, f).toMatch(/switchLocale\(next\)/)
      expect(text, f).not.toMatch(/document\.cookie/)
      expect(text, f).not.toMatch(/location\.reload/)
    }
  })
})
