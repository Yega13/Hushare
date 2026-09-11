// Mutations for the only admin action that TAKES something away.
//
// It deletes a billing row on a table where one person can hold two: a cancelled real subscription
// and a comped grant. Deleting by anything other than the row's own primary key would have to
// guess between them, and the wrong guess either restores access somebody lost or removes access
// somebody is paying for.
export default {
  file: 'src/app/api/admin/action/route.ts',
  test: 'tests/route-wiring-admin-delete-sub.test.ts',
  mutations: [
    {
      name: 'the admin gate is removed, so anyone signed in can delete a billing row',
      from: "  if (!isAccountAdmin(user)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })",
      to: '  if (false) return NextResponse.json({ error: 0 }, { status: 404, headers: NO_STORE })',
    },
    {
      name: 'the CSRF guard is removed from every admin action',
      from: '  if (csrf) return csrf',
      to: '  if (false) return csrf',
    },
    {
      name: 'a missing row id is accepted and the delete runs against undefined',
      from: "    if (!subscriptionId) return NextResponse.json({ error: 'Missing subscriptionId' }, { status: 400, headers: NO_STORE })",
      to: '    if (false) return NextResponse.json({ error: 0 }, { status: 400, headers: NO_STORE })',
    },
    {
      name: 'a row that does not exist is reported as deleted',
      from: "    if (!row) return NextResponse.json({ error: 'Subscription not found' }, { status: 404, headers: NO_STORE })",
      to: '    if (false) return NextResponse.json({ error: 0 }, { status: 404, headers: NO_STORE })',
    },
    {
      name: 'a failed delete is reported as a success',
      from: "    const { error } = await admin.from('subscriptions').delete().eq('id', subscriptionId)",
      to: "    await admin.from('subscriptions').delete().eq('id', subscriptionId); const error = null",
    },
    {
      name: 'the live-subscription warning is dropped, so a row silently returns on the next reconcile',
      from: "    const live = !wasComped && String(row.status ?? '') === 'active'",
      to: '    const live = false',
    },
    {
      name: 'a comped row is warned about as if it were still billing',
      from: '    const wasComped = isCompedSubscription(row)',
      to: '    const wasComped = false',
    },
  ],
}
