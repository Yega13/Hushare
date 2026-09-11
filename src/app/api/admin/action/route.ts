import { NextResponse } from 'next/server'
import { serverError } from '@/lib/server/respond'
import { randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'
import { isCompedSubscription } from '@/lib/subscription-origin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { sendOwnerLinkEmail } from '@/lib/email'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space').replace(/\/+$/, '')

// Admin-only privileged support actions. One endpoint, switch on `action`. CSRF-guarded, admin-gated,
// 404 to non-admins. All writes go through the service-role client (tables are RLS deny-all).
export async function POST(req: Request) {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!isAccountAdmin(user)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })

  const body = await req.json().catch(() => null) as
    { action?: string; userId?: string; albumId?: string; tier?: string; months?: number
      subscriptionId?: string } | null
  const admin = createAdminClient()

  // ── Grant / extend a complimentary subscription ──
  if (body?.action === 'comp_sub') {
    const userId = body.userId
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400, headers: NO_STORE })
    const tier = body.tier === 'pro' ? 'pro' : 'studio'
    const months = Math.max(1, Math.min(120, Math.round(Number(body.months ?? 12)) || 12))
    const periodEnd = new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000).toISOString()
    const fields = {
      user_id: userId, polar_product_id: `comp-${tier}`, tier, status: 'active',
      current_period_end: periodEnd, cancel_at_period_end: false, updated_at: new Date().toISOString(),
    }
    // Extend the existing comp row if there is one, else insert — never leaves duplicate comp rows.
    const { data: existing } = await admin
      .from('subscriptions').select('id').eq('user_id', userId).like('polar_product_id', 'comp-%').maybeSingle()
    const { error } = existing
      ? await admin.from('subscriptions').update(fields).eq('id', existing.id)
      : await admin.from('subscriptions').insert({ id: randomUUID(), polar_subscription_id: `comp-${randomUUID()}`, polar_customer_id: '', ...fields })
    if (error) return serverError('admin/action', error.message, { publicMessage: error.message })
    return NextResponse.json({ ok: true, message: `${tier} granted through ${periodEnd.slice(0, 10)}` }, { headers: NO_STORE })
  }

  // ── Remove a subscription row ──
  //
  // FOR THE ROWS THAT ARE NOT REVENUE AND WILL NEVER BECOME IT: a gift that has served its purpose,
  // and the leftover row of a customer who cancelled. Both sit in the dashboard looking like
  // something they are not, and until now the only way to remove one was a hand-written SQL
  // statement against production.
  //
  // ONE ROW, BY ITS OWN PRIMARY KEY. Never by user_id: alinagnuni3 holds two rows -- a cancelled
  // real subscription and a comped studio grant -- and "delete this person's subscription" would
  // have had to guess which, on a table where the wrong guess either restores access somebody lost
  // or removes access somebody paid for.
  //
  // WHAT THIS DOES NOT DO: it does not touch Polar. Deleting the local row of a LIVE subscription
  // does not stop the billing, and the next reconcile pulls the row straight back -- which is the
  // safe direction (we cannot silently cancel someone's paid plan from here), but it means the
  // button is for tidying the ledger, not for ending a subscription. The response says so rather
  // than leaving the admin to discover it.
  if (body?.action === 'delete_sub') {
    const subscriptionId = body.subscriptionId
    if (!subscriptionId) return NextResponse.json({ error: 'Missing subscriptionId' }, { status: 400, headers: NO_STORE })
    const { data: row } = await admin
      .from('subscriptions')
      .select('id, user_id, tier, status, polar_subscription_id, polar_product_id')
      .eq('id', subscriptionId).maybeSingle()
    if (!row) return NextResponse.json({ error: 'Subscription not found' }, { status: 404, headers: NO_STORE })

    const { error } = await admin.from('subscriptions').delete().eq('id', subscriptionId)
    if (error) return serverError('admin/action', error.message, { publicMessage: error.message })

    // Said plainly, because the two cases have different consequences and the admin is about to
    // look at a dashboard that no longer shows the row either way.
    const wasComped = isCompedSubscription(row)
    const live = !wasComped && String(row.status ?? '') === 'active'
    const message = live
      ? `Removed the ${row.tier} row. This did NOT cancel their Polar subscription — it is still billing, and the next reconcile will restore this row.`
      : `Removed the ${wasComped ? 'comped' : 'cancelled'} ${row.tier} row.`
    return NextResponse.json({ ok: true, message }, { headers: NO_STORE })
  }

  // ── Reset an album's retention clock (and un-retire a soft-retired one) ──
  if (body?.action === 'extend_retention') {
    if (!body.albumId) return NextResponse.json({ error: 'Missing albumId' }, { status: 400, headers: NO_STORE })
    // deleted_at IS CLEARED TOO. This clears retired_at, which is also what hides an album the
    // owner deleted — so on a binned album, clearing only retired_at would make it public again
    // while it was still queued for destruction, and the next nightly pass would then delete an
    // album that was visibly live. Clearing both is "restore from the bin", which is what an
    // admin reaching for this on a deleted album actually wants.
    const { error } = await admin.from('albums')
      .update({ last_activity_at: new Date().toISOString(), retired_at: null, deleted_at: null })
      .eq('id', body.albumId)
    if (error) return serverError('admin/action', error.message, { publicMessage: error.message })
    return NextResponse.json({ ok: true, message: 'Retention reset — one more year from today.' }, { headers: NO_STORE })
  }

  // ── Re-send the album's private owner/management link to the owner's account email ──
  if (body?.action === 'resend_owner_link') {
    if (!body.albumId) return NextResponse.json({ error: 'Missing albumId' }, { status: 400, headers: NO_STORE })
    const { data: album } = await admin
      .from('albums').select('slug, custom_slug, title, owner_token, user_id').eq('id', body.albumId)
      .maybeSingle()
    if (!album) return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
    if (!album.user_id) return NextResponse.json({ error: 'Anonymous album — no account email to send to.' }, { status: 400, headers: NO_STORE })
    const { data: au } = await admin.auth.admin.getUserById(album.user_id)
    const email = au?.user?.email
    if (!email) return NextResponse.json({ error: 'Owner has no email on file.' }, { status: 400, headers: NO_STORE })
    const link = `${SITE_ORIGIN}/${album.custom_slug ?? album.slug}#owner=${encodeURIComponent(album.owner_token)}`
    try {
      await sendOwnerLinkEmail(email, album.title, link)
    } catch (e) {
      return serverError('admin/action', e instanceof Error ? e.message : 'Email send failed', { publicMessage: e instanceof Error ? e.message : 'Email send failed' })
    }
    return NextResponse.json({ ok: true, message: `Management link sent to ${email}` }, { headers: NO_STORE })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers: NO_STORE })
}
