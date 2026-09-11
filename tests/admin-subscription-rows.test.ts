import { describe, it, expect } from 'vitest'
import { houseAccountRows, splitSubscriptions, type SubscriptionRow } from '@/lib/admin-subscription-rows'

// THE SPLIT THAT WAS WRONG FOR AS LONG AS IT EXISTED.
//
// It lived inside a 900-line page, so it had nowhere to be tested from. The comp test asked whether
// polar_product_id started with "comp-"; the comp SCRIPT writes the bare string "comp". Gifts sent
// by the script were counted as revenue and gifts sent by the button were not, and nothing could
// notice. The fixtures below are the live table as it actually was.

const REAL_PRODUCT = '1afab126-3496-48d4-af31-705405791c38'

const scriptComp: SubscriptionRow = {
  id: 'r1', user_id: 'u-grigore', tier: 'pro', status: 'active',
  polar_subscription_id: 'comp-c414fa3d', polar_product_id: 'comp',
}
const buttonComp: SubscriptionRow = {
  id: 'r2', user_id: 'u-alina', tier: 'studio', status: 'active',
  polar_subscription_id: 'comp-4b01c199', polar_product_id: 'comp-studio',
}
const realPaid: SubscriptionRow = {
  id: 'r3', user_id: 'u-annie', tier: 'pro', status: 'active',
  polar_subscription_id: 'e694448f-8edb', polar_product_id: REAL_PRODUCT,
}
const realCancelled: SubscriptionRow = {
  id: 'r4', user_id: 'u-alina', tier: 'pro', status: 'canceled',
  polar_subscription_id: '198b2f55-9f05', polar_product_id: REAL_PRODUCT,
}

const emails = new Map([
  ['u-grigore', 'grigore@example.com'],
  ['u-alina', 'alina@example.com'],
  ['u-annie', 'annie@example.com'],
])
const noAdmins = () => false

describe('splitSubscriptions — revenue on one side, us on the other', () => {
  it('puts a gift made by the SCRIPT on the house side', () => {
    // The whole bug: "comp" does not start with "comp-", so this row was counted as revenue.
    const { paying, house } = splitSubscriptions([scriptComp], emails, noAdmins)
    expect(house).toHaveLength(1)
    expect(paying).toHaveLength(0)
  })

  it('puts a gift made by the BUTTON on the house side too', () => {
    const { house } = splitSubscriptions([buttonComp], emails, noAdmins)
    expect(house).toHaveLength(1)
  })

  it('leaves a real paying customer on the revenue side', () => {
    const { paying, house } = splitSubscriptions([realPaid], emails, noAdmins)
    expect(paying).toHaveLength(1)
    expect(house).toHaveLength(0)
  })

  it('keeps a CANCELLED real subscription on the revenue side', () => {
    // It is over, but it was real money and it is not a gift. Moving it in with the comps would
    // hide a churn event among our own accounts.
    const { paying } = splitSubscriptions([realCancelled], emails, noAdmins)
    expect(paying.map((s) => s.id)).toEqual(['r4'])
  })

  it('treats an admin as house even with a perfectly real subscription', () => {
    // An admin is not a customer. computeUserTier grants them Max in code regardless.
    const isAdmin = (email: string | null | undefined) => email === 'annie@example.com'
    const { paying, house } = splitSubscriptions([realPaid], emails, isAdmin)
    expect(house).toHaveLength(1)
    expect(paying).toHaveLength(0)
  })

  it('splits a mixed table without losing or duplicating a row', () => {
    const all = [scriptComp, buttonComp, realPaid, realCancelled]
    const { paying, house } = splitSubscriptions(all, emails, noAdmins)
    expect(paying.length + house.length).toBe(all.length)
    expect([...paying, ...house].map((s) => s.id).sort()).toEqual(['r1', 'r2', 'r3', 'r4'])
  })

  it('preserves the order the page sorted them in', () => {
    const { paying } = splitSubscriptions([realCancelled, realPaid], emails, noAdmins)
    expect(paying.map((s) => s.id)).toEqual(['r4', 'r3'])
  })

  it('does not crash on a row with no user', () => {
    const orphan: SubscriptionRow = { id: 'r9', user_id: null, polar_product_id: REAL_PRODUCT }
    const { paying } = splitSubscriptions([orphan], emails, noAdmins)
    expect(paying).toHaveLength(1)
  })
})

describe('houseAccountRows — people, not rows', () => {
  const admins = [{ id: 'u-owner', email: 'owner@example.com' }]
  const isAdminUser = (u: { email?: string | null }) => u.email === 'owner@example.com'

  it('lists an admin who holds NO subscription row at all', () => {
    // The failure this exists for: a row-based section showed "None." while a comped row sat in
    // the revenue table. An admin's Max comes from code, so there is no row to list them from.
    const rows = houseAccountRows([], admins, emails, isAdminUser)
    expect(rows.map((r) => r.email)).toEqual(['owner@example.com'])
    expect(rows[0].why).toBe('admin')
  })

  it('gives an admin with no comp NO gift mark and nothing to remove', () => {
    // A present beside our own account would be a lie about where the tier came from, and a remove
    // button there would promise to undo something this table cannot reach.
    const rows = houseAccountRows([], admins, emails, isAdminUser)
    expect(rows[0].comped).toBe(false)
    expect(rows[0].subId).toBeNull()
  })

  it('marks a comped non-admin as a gift, and carries the row id so it can be removed', () => {
    const rows = houseAccountRows([scriptComp], [], emails, isAdminUser)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      email: 'grigore@example.com', tier: 'pro', why: 'comped', comped: true, subId: 'r1',
    })
  })

  it('lists an admin who ALSO holds a comp once, with both reasons and the row id', () => {
    const owner = [{ id: 'u-owner', email: 'owner@example.com' }]
    const ownerComp: SubscriptionRow = {
      id: 'r5', user_id: 'u-owner', tier: 'studio', status: 'active',
      polar_subscription_id: 'comp-x', polar_product_id: 'comp',
    }
    const rows = houseAccountRows([ownerComp], owner, emails, isAdminUser)
    expect(rows).toHaveLength(1)
    expect(rows[0].why).toBe('admin · comped')
    expect(rows[0].subId).toBe('r5')
    expect(rows[0].comped).toBe(true)
  })

  it('does not list one person twice when they are both an admin and comped', () => {
    const owner = [{ id: 'u-owner', email: 'owner@example.com' }]
    const ownerComp: SubscriptionRow = {
      id: 'r5', user_id: 'u-owner', polar_subscription_id: 'comp-x', tier: 'studio', status: 'active',
    }
    const emailsWithOwner = new Map([...emails, ['u-owner', 'owner@example.com']])
    const rows = houseAccountRows([ownerComp], owner, emailsWithOwner, isAdminUser)
    expect(rows.filter((r) => r.email === 'owner@example.com')).toHaveLength(1)
  })

  it('carries the status through, so a dead comp is not shown as a live one', () => {
    const expired: SubscriptionRow = {
      id: 'r6', user_id: 'u-grigore', tier: 'pro', status: 'canceled', polar_subscription_id: 'comp-y',
    }
    const rows = houseAccountRows([expired], [], emails, isAdminUser)
    expect(rows[0].status).toBe('canceled')
  })

  it('names a comped row whose user cannot be resolved rather than dropping it', () => {
    const unknown: SubscriptionRow = { id: 'r7', user_id: 'u-gone', polar_subscription_id: 'comp-z', tier: 'pro' }
    const rows = houseAccountRows([unknown], [], emails, isAdminUser)
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe('(user)')
  })

  it('lists two different comped people separately', () => {
    const rows = houseAccountRows([scriptComp, buttonComp], [], emails, isAdminUser)
    expect(rows.map((r) => r.email)).toEqual(['grigore@example.com', 'alina@example.com'])
  })
})
