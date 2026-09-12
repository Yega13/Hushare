import { LOCALE_COOKIE, type Locale } from '@/i18n/config'

// CHOOSING A LANGUAGE: remember it for a year, then reload, so every server-rendered string on the
// page is rendered again in the language that was picked.
//
// Both switchers -- the footer dropdown and the account page's flags -- wrote this cookie by hand,
// each with its own copy of the lifetime and the flags. That is the rule-13 shape, and it is also
// why react-hooks flagged both components: assigning to a global from inside a component. One
// function, outside any component, owns it now. The server only ever reads the value
// (src/i18n/server.ts), so this is the one place its lifetime and scope are decided.

/** How long the choice is remembered. */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/** The exact cookie string for a chosen language. Pure, so its flags are tested rather than trusted. */
export function localeCookie(next: Locale): string {
  return `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`
}

/**
 * Remember the choice, then reload. The document and the reload are injectable so a test can watch
 * both, and their order, without navigating; production passes nothing.
 */
export function switchLocale(
  next: Locale,
  doc: Pick<Document, 'cookie'> = document,
  reload: () => void = () => window.location.reload(),
): void {
  doc.cookie = localeCookie(next)
  reload()
}
