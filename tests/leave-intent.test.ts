import { describe, it, expect } from 'vitest'
import { isRealLeavePop, leaveDestination, type LeaveClick } from '../src/lib/leave-intent'

// IS THIS A REAL LEAVE? One case per predicate; the download case is the shipped bug.

const PAGE = { origin: 'https://hushare.space', pathname: '/race', href: 'https://hushare.space/race' }
const click = (over: Partial<LeaveClick> = {}): LeaveClick => ({
  button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
  href: '/', download: false, target: null, ...over,
})

describe('isRealLeavePop', () => {
  it("the album's base entry (no flags) is a real leave", () => {
    expect(isRealLeavePop(null)).toBe(true)
    expect(isRealLeavePop({})).toBe(true)
    expect(isRealLeavePop({ other: 1 })).toBe(true)
  })
  it('landing back on OUR entry, or on the lightbox entry, is not a leave', () => {
    expect(isRealLeavePop({ hushSave: true })).toBe(false)
    expect(isRealLeavePop({ hushLightbox: true })).toBe(false)
  })
})

describe('leaveDestination', () => {
  it('a plain left click on an in-app link to another path is a leave, resolved to an absolute URL', () => {
    expect(leaveDestination(click(), PAGE)).toBe('https://hushare.space/')
    expect(leaveDestination(click({ href: '/account?x=1' }), PAGE)).toBe('https://hushare.space/account?x=1')
    expect(leaveDestination(click({ href: '/race/anything' }), PAGE)).toBe('https://hushare.space/race/anything')
  })
  it('a DOWNLOAD link is never a leave (the hidden <a download> the zip button clicks)', () => {
    expect(leaveDestination(click({ href: '/api/album/zip', download: true }), PAGE)).toBeNull()
  })
  it('a click something already handled, or not the main button, is not a leave', () => {
    expect(leaveDestination(click({ defaultPrevented: true }), PAGE)).toBeNull()
    expect(leaveDestination(click({ button: 1 }), PAGE)).toBeNull()
  })
  it('a modifier means a new tab, not a leave', () => {
    for (const k of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
      expect(leaveDestination(click({ [k]: true }), PAGE), k).toBeNull()
    }
  })
  it('no link, or a link that opens elsewhere, is not a leave; _self is', () => {
    expect(leaveDestination(click({ href: null }), PAGE)).toBeNull()
    expect(leaveDestination(click({ href: '' }), PAGE)).toBeNull()
    expect(leaveDestination(click({ target: '_blank' }), PAGE)).toBeNull()
    expect(leaveDestination(click({ target: '_self' }), PAGE)).toBe('https://hushare.space/')
  })
  it('same page, a hash, a foreign site, mailto: none is a leave', () => {
    expect(leaveDestination(click({ href: '/race' }), PAGE)).toBeNull()
    expect(leaveDestination(click({ href: '#top' }), PAGE)).toBeNull()
    expect(leaveDestination(click({ href: '/race?photo=3' }), PAGE)).toBeNull()
    expect(leaveDestination(click({ href: 'https://example.com/x' }), PAGE)).toBeNull()
    expect(leaveDestination(click({ href: 'mailto:hi@example.com' }), PAGE)).toBeNull()
  })
  it('an href the URL parser refuses is not a leave', () => {
    expect(leaveDestination(click({ href: 'http://[bad' }), PAGE)).toBeNull()
  })
})
