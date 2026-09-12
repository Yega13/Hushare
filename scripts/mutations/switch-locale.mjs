// Mutation set for src/lib/switch-locale.ts -- run with: node scripts/mutations/run.mjs switch-locale
//
// Choosing a language. Each mutation below leaves the switch looking like it worked and the page
// in the wrong language: the cookie scoped to one path, forgotten tomorrow, or written after the
// reload has already started.
export default {
  file: 'src/lib/switch-locale.ts',
  test: 'tests/switch-locale.test.ts',
  mutations: [
  { name: 'THE RELOAD COMES FIRST, so the page reloads in the old language',
    from: "  doc.cookie = localeCookie(next)\n  reload()", to: "  reload()\n  doc.cookie = localeCookie(next)" },
  { name: 'there is no reload, so nothing on the page changes language',
    from: "  doc.cookie = localeCookie(next)\n  reload()", to: "  doc.cookie = localeCookie(next)" },
  { name: 'the cookie is never written',
    from: "  doc.cookie = localeCookie(next)\n", to: "" },
  { name: 'the cookie is scoped to the current path, so the choice is lost on the next page',
    from: "; path=/;", to: ";" },
  { name: 'the choice is forgotten after a day',
    from: "export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365", to: "export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24" },
  { name: 'the cookie loses SameSite',
    from: "; SameSite=Lax", to: "" },
  ],
}
