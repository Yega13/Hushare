import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'
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
    { action?: string; userId?: string; albumId?: string; tier?: string; months?: number } | null
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
      .from('subscriptions').select('id').eq('user_id', userId).like('polar_product_id', 'comp-%').maybeSingle<{ id: string }>()
    const { error } = existing
      ? await admin.from('subscriptions').update(fields).eq('id', existing.id)
      : await admin.from('subscriptions').insert({ id: randomUUID(), polar_subscription_id: `comp-${randomUUID()}`, polar_customer_id: '', ...fields })
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
    return NextResponse.json({ ok: true, message: `${tier} granted through ${periodEnd.slice(0, 10)}` }, { headers: NO_STORE })
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
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
    return NextResponse.json({ ok: true, message: 'Retention reset — one more year from today.' }, { headers: NO_STORE })
  }

  // ── Re-send the album's private owner/management link to the owner's account email ──
  if (body?.action === 'resend_owner_link') {
    if (!body.albumId) return NextResponse.json({ error: 'Missing albumId' }, { status: 400, headers: NO_STORE })
    const { data: album } = await admin
      .from('albums').select('slug, custom_slug, title, owner_token, user_id').eq('id', body.albumId)
      .maybeSingle<{ slug: string; custom_slug: string | null; title: string; owner_token: string; user_id: string | null }>()
    if (!album) return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
    if (!album.user_id) return NextResponse.json({ error: 'Anonymous album — no account email to send to.' }, { status: 400, headers: NO_STORE })
    const { data: au } = await admin.auth.admin.getUserById(album.user_id)
    const email = au?.user?.email
    if (!email) return NextResponse.json({ error: 'Owner has no email on file.' }, { status: 400, headers: NO_STORE })
    const link = `${SITE_ORIGIN}/${album.custom_slug ?? album.slug}#owner=${encodeURIComponent(album.owner_token)}`
    try {
      await sendOwnerLinkEmail(email, album.title, link)
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Email send failed' }, { status: 500, headers: NO_STORE })
    }
    return NextResponse.json({ ok: true, message: `Management link sent to ${email}` }, { headers: NO_STORE })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers: NO_STORE })
}
