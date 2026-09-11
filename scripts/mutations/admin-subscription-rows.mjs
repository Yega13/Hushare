// Mutations for the split between revenue and us.
//
// This lived inside a 900-line admin page, which is why it was wrong for as long as it was: there
// was nowhere to test it from. A dashboard that counts its own gifts as revenue is wrong in the
// flattering direction, quietly, and every number built on it inherits that.
export default {
  file: 'src/lib/admin-subscription-rows.ts',
  test: 'tests/admin-subscription-rows.test.ts',
  mutations: [
    {
      name: 'comped rows are counted as revenue again',
      from: '    if (isCompedSubscription(sub) || isAdminEmail(email)) house.push(sub)',
      to: '    if (isAdminEmail(email)) house.push(sub)',
    },
    {
      name: 'admins are counted as customers',
      from: '    if (isCompedSubscription(sub) || isAdminEmail(email)) house.push(sub)',
      to: '    if (isCompedSubscription(sub)) house.push(sub)',
    },
    {
      name: 'a cancelled real subscription is filed with the gifts, hiding a churn event',
      from: '    if (isCompedSubscription(sub) || isAdminEmail(email)) house.push(sub)',
      to: "    if (isCompedSubscription(sub) || isAdminEmail(email) || sub.status !== 'active') house.push(sub)",
    },
    {
      name: 'admins holding no subscription row vanish from the house table',
      from: '  for (const user of allUsers) {',
      to: '  for (const user of []) {',
    },
    {
      name: 'an admin with no comp is marked as a gift, putting a present beside our own account',
      from: '      comped: comp !== undefined,',
      to: '      comped: true,',
    },
    {
      name: 'the row id is dropped, so nothing in the house table can be removed',
      from: '      subId: comp?.id ?? null,',
      to: '      subId: null,',
    },
    {
      name: 'a comped non-admin loses their row id and their gift cannot be taken back',
      from: '      subId: sub.id ?? null,',
      to: '      subId: null,',
    },
    {
      name: 'one person is listed twice when they are both an admin and comped',
      from: '    if (sub.user_id && seenUsers.has(sub.user_id)) continue',
      to: '    if (false) continue',
    },
    {
      name: 'the comp row of an admin is ignored, so it can never be found or removed',
      from: '    const comp = houseSubs.find((s) => s.user_id != null && s.user_id === user.id && isCompedSubscription(s))',
      to: '    const comp = undefined',
    },
    {
      name: 'status is not carried, so an expired comp reads as a live one',
      from: "      status: String(sub.status ?? ''),",
      to: "      status: 'active',",
    },
  ],
}
