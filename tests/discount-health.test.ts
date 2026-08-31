import { describe, it, expect } from 'vitest'
import { discountBanner, discountRowsToShow } from '../src/lib/discount-health'
import type { DiscountHealth } from '../src/lib/polar'

const h = (...states: DiscountHealth['state'][]): DiscountHealth[] =>
  states.map((state, i) => ({ plan: `plan${i}`, id: `id${i}`, state }))

describe('discountBanner', () => {
  it('stays silent only when every discount actually answered OK', () => {
    expect(discountBanner(h('ok', 'ok'))).toBe('none')
  })

  it('raises the alarm for a discount Polar no longer has', () => {
    // Customers eligible for the intro are being charged full price right now.
    expect(discountBanner(h('ok', 'missing'))).toBe('alarm')
    expect(discountBanner(h('unset', 'ok'))).toBe('alarm')
  })

  it('NEVER shows nothing when the check could not run — the bug this exists for', () => {
    // An unreachable Polar, or an expired API key, used to render an empty panel. An empty panel
    // reads as "the intro pricing is fine", which is a claim nobody had verified.
    expect(discountBanner(h('unknown', 'unknown'))).toBe('unverified')
    expect(discountBanner(h('ok', 'unknown'))).toBe('unverified')
  })

  it('does not downgrade a real failure just because another one is unreachable', () => {
    expect(discountBanner(h('missing', 'unknown'))).toBe('alarm')
  })

  it('says nothing when nothing is configured to check', () => {
    expect(discountBanner([])).toBe('none')
  })
})

describe('discountRowsToShow', () => {
  it('never lists a healthy discount under either banner', () => {
    const rows = h('ok', 'missing', 'unknown')
    expect(discountRowsToShow(rows, 'alarm').every((d) => d.state !== 'ok')).toBe(true)
    expect(discountRowsToShow(rows, 'unverified').every((d) => d.state !== 'ok')).toBe(true)
  })

  it('lists the unusable ones under the alarm, including the unreachable', () => {
    // Under a real alarm the owner is already in the dashboard; showing everything unresolved is
    // useful there, where it would be noise on its own.
    expect(discountRowsToShow(h('ok', 'missing', 'unknown'), 'alarm').map((d) => d.state))
      .toEqual(['missing', 'unknown'])
  })

  it('lists only the unreachable ones under the quiet notice', () => {
    expect(discountRowsToShow(h('ok', 'unknown'), 'unverified').map((d) => d.state)).toEqual(['unknown'])
  })

  it('lists nothing when there is no banner', () => {
    expect(discountRowsToShow(h('ok', 'ok'), 'none')).toEqual([])
  })
})
