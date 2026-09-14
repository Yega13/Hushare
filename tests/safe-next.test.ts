import { describe, it, expect } from 'vitest'
import { safeNextPath } from '@/lib/safe-next'

// A `next` PARAMETER NAMES A PAGE ON THIS SITE, OR NOTHING.
//
// The two attacks at the top were run through Node's URL parser on 2026-09-14 against the check six
// sign-in paths used, and both landed on https://evil.example. Every refusal below is asserted by where
// the returned path would LAND, not by the string it happens to contain.

const ORIGIN = 'https://hushare.space'
const BS = String.fromCharCode(92)
const landsHome = (path: string | null) => path === null || new URL(path, ORIGIN).origin === ORIGIN

describe('the attacks the old check let through', () => {
  it('A DOUBLE SLASH AFTER OUR OWN ORIGIN is refused (it redirected to evil.example)', () => {
    expect(safeNextPath('https://hushare.space//evil.example', ORIGIN)).toBeNull()
  })

  it('A BACKSLASH the parser turns into a second slash is refused', () => {
    expect(safeNextPath(`https://hushare.space/${BS}evil.example`, ORIGIN)).toBeNull()
  })

  it('the same tricks with a query or deeper path are refused', () => {
    expect(safeNextPath('https://hushare.space//evil.example/login?x=1', ORIGIN)).toBeNull()
    expect(safeNextPath(`https://hushare.space/${BS}${BS}evil.example`, ORIGIN)).toBeNull()
  })
})

describe('other ways to leave the site', () => {
  it('another origin, a lookalike host, a scheme-relative link', () => {
    for (const raw of ['https://evil.example/account', 'https://hushare.space.evil.example/', '//evil.example', `${BS}${BS}evil.example`, 'http://hushare.space/account']) {
      expect(safeNextPath(raw, ORIGIN), raw).toBeNull()
    }
  })

  it('a script URL, and one with whitespace the parser strips', () => {
    expect(safeNextPath('javascript:alert(1)', ORIGIN)).toBeNull()
    expect(safeNextPath('/\t/evil.example', ORIGIN)).toBeNull()
    expect(safeNextPath('/\n/evil.example', ORIGIN)).toBeNull()
  })

  it('nothing, or something that is not a URL, is no destination', () => {
    expect(safeNextPath('', ORIGIN)).toBeNull()
    expect(safeNextPath(null, ORIGIN)).toBeNull()
    expect(safeNextPath(undefined, ORIGIN)).toBeNull()
    expect(safeNextPath('http://[', ORIGIN)).toBeNull()
  })
})

describe('real destinations still work', () => {
  it('a path, with its query, and without its fragment', () => {
    expect(safeNextPath('/account', ORIGIN)).toBe('/account')
    expect(safeNextPath('/abcd1234?s=qr', ORIGIN)).toBe('/abcd1234?s=qr')
    expect(safeNextPath('/pricing#max', ORIGIN)).toBe('/pricing')
  })

  it('our own absolute URL becomes its path', () => {
    expect(safeNextPath('https://hushare.space/account?tab=albums', ORIGIN)).toBe('/account?tab=albums')
  })

  it('an encoded slash stays an encoded, same-site path', () => {
    const path = safeNextPath('/%2F%2Fevil.example', ORIGIN)
    expect(path).toBe('/%2F%2Fevil.example')
    expect(landsHome(path)).toBe(true)
  })

  it('a relative path resolves against the site root', () => {
    expect(safeNextPath('account', ORIGIN)).toBe('/account')
  })
})

describe('whatever it returns lands on this site', () => {
  it('holds across every input above and a spread of odd ones', () => {
    const inputs = [
      'https://hushare.space//evil.example', `https://hushare.space/${BS}evil.example`, '//evil.example', '/account',
      '/./../..//evil.example', '/%2e%2e//evil.example', '///evil.example', `/${BS}/evil.example`, 'https:evil.example',
      'https:/evil.example', '/?next=//evil.example', ' //evil.example', '\t//evil.example',
    ]
    for (const raw of inputs) expect(landsHome(safeNextPath(raw, ORIGIN)), JSON.stringify(raw)).toBe(true)
  })
})
