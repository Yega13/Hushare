import { describe, it, expect } from 'vitest'
import { isCompedSubscription, subscriptionOrigin } from '@/lib/subscription-origin'

// THE TWO SHAPES THE MARKER ACTUALLY ARRIVES IN.
//
// These are not invented fixtures. They were read off the live subscriptions table: the comp
// script writes polar_product_id = "comp", the admin button writes "comp-pro"/"comp-studio", and
// both write polar_subscription_id = "comp-<uuid>". The dashboard asked only whether the PRODUCT id
// started with "comp-", so the script's gifts were counted as revenue and the button's were not.

const REAL_PRODUCT = '1afab126-3496-48d4-af31-705405791c38'
const REAL_SUB = 'e694448f-8edb-4a53-9c1e-1f2a3b4c5d6e'

describe('what the live table actually holds', () => {
  it('counts a gift made by the SCRIPT as comped — the row that was being read as revenue', () => {
    expect(subscriptionOrigin({
      polar_subscription_id: 'comp-c414fa3d-bf62-4a1b-9d3e-000000000000',
      polar_product_id: 'comp',
    })).toBe('comped')
  })

  it('counts a gift made by the admin BUTTON as comped', () => {
    expect(subscriptionOrigin({
      polar_subscription_id: 'comp-4b01c199-65b5-4c7a-8e1f-000000000000',
      polar_product_id: 'comp-studio',
    })).toBe('comped')
  })

  it('counts a real Polar subscription as paid', () => {
    expect(subscriptionOrigin({
      polar_subscription_id: REAL_SUB, polar_product_id: REAL_PRODUCT,
    })).toBe('paid')
  })

  it('does not let a cancelled real subscription become a gift', () => {
    // Status is a different question entirely, and the origin must not quietly depend on it.
    expect(isCompedSubscription({ polar_subscription_id: REAL_SUB, polar_product_id: REAL_PRODUCT }))
      .toBe(false)
  })
})

describe('either column alone is enough', () => {
  it('reads the marker from the subscription id when the product id is a real one', () => {
    // The shape a comp takes if a future writer forgets the product column: the subscription id is
    // the marker both writers have always set, and the one --clear deletes on.
    expect(isCompedSubscription({
      polar_subscription_id: 'comp-abc', polar_product_id: REAL_PRODUCT,
    })).toBe(true)
  })

  it('reads the marker from the product id when the subscription id is a real one', () => {
    expect(isCompedSubscription({
      polar_subscription_id: REAL_SUB, polar_product_id: 'comp-pro',
    })).toBe(true)
  })

  it('accepts the bare prefix, which is the shape that caused the bug', () => {
    expect(isCompedSubscription({ polar_product_id: 'comp' })).toBe(true)
  })
})

describe('a real Polar id can never be mistaken for a marker', () => {
  it('leaves every hex-and-dash identifier alone', () => {
    // Polar ids are UUIDs. "o", "m" and "p" are not hex digits, so no real id can begin "comp" --
    // which is what makes the bare prefix safe rather than reckless.
    for (const id of [REAL_PRODUCT, REAL_SUB, 'c0ffee00-dead-beef-cafe-000000000000', 'cccccccc-cccc-cccc-cccc-cccccccccccc']) {
      expect(subscriptionOrigin({ polar_subscription_id: id, polar_product_id: id }), id).toBe('paid')
    }
  })

  it('does not match a value that merely CONTAINS the marker later on', () => {
    expect(isCompedSubscription({ polar_subscription_id: 'sub-comp-1' })).toBe(false)
  })
})

describe('missing and malformed values', () => {
  it('treats a row with no identifiers at all as paid rather than inventing a gift', () => {
    expect(subscriptionOrigin({})).toBe('paid')
    expect(subscriptionOrigin({ polar_subscription_id: null, polar_product_id: null })).toBe('paid')
    expect(subscriptionOrigin({ polar_subscription_id: '', polar_product_id: '' })).toBe('paid')
  })

  it('survives a non-string in either column without throwing', () => {
    // subscriptions is written by a webhook and by two scripts; the column is text but the value
    // reaching this function has been through JSON more than once.
    const junk = { polar_subscription_id: 12345, polar_product_id: {} } as unknown as
      { polar_subscription_id?: string | null; polar_product_id?: string | null }
    expect(() => subscriptionOrigin(junk)).not.toThrow()
    expect(subscriptionOrigin(junk)).toBe('paid')
  })

  it('ignores surrounding whitespace and case, which a hand-run script can introduce', () => {
    expect(isCompedSubscription({ polar_product_id: '  COMP-studio ' })).toBe(true)
  })
})
