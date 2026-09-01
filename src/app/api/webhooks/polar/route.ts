import { NextResponse } from 'next/server'
import { reportServerError } from '@/lib/report-server-error'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyWebhookSignature, tierFromProduct, getCustomerEmail } from '@/lib/polar'
import { findOrCreateUserByEmail } from '@/lib/provision-user'
import { track } from '@/lib/analytics'
import { packageGrantForProduct, applyPackageGrant } from '@/lib/package-purchase'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type PolarSubscription = {
  id: string
  status: string
  customer_id: string
  product_id: string
  current_period_end: string | null
  cancel_at_period_end?: boolean
  ended_at?: string | null
  // When Polar last changed this subscription. Used to reject a retried event that arrives after a
  // newer one — our own updated_at only records when WE processed it, which is what gets reordered.
  modified_at?: string | null
  // Some events embed the customer (with email); if absent we fetch it by customer_id.
  customer?: { email?: string | null } | null
  metadata?: { userId?: string; tier?: string; cycle?: string }
}

type PolarEvent = {
  type: string
  data: PolarSubscription
}

export async function POST(req: Request) {
  const secret = process.env.POLAR_WEBHOOK_SECRET
  if (!secret) {
    console.error('[polar/webhook] POLAR_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
  }

  // Signature is computed over the *raw* body bytes — read once, verify before parsing.
  const rawBody = await req.text()

  // Support zero-downtime secret rotation: set POLAR_WEBHOOK_SECRET_PREVIOUS to the old
  // value, deploy, update Polar's endpoint to the new secret, then clear the old env var.
  const previousSecret = process.env.POLAR_WEBHOOK_SECRET_PREVIOUS
  const secrets = previousSecret ? [secret, previousSecret] : [secret]
  let verified = false
  for (const s of secrets) {
    if (await verifyWebhookSignature(rawBody, req.headers, s)) {
      verified = true
      break
    }
  }
  if (!verified) {
    console.warn('[polar/webhook] signature verification failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401, headers: NO_STORE })
  }

  let event: PolarEvent
  try {
    event = JSON.parse(rawBody) as PolarEvent
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400, headers: NO_STORE })
  }

  // ── ONE-TIME PACKAGE ORDERS ──────────────────────────────────────────────────
  //
  // order.paid is where a $49/$99 package or a $9/$19 renewal becomes an album entitlement.
  // Subscriptions ALSO emit order events, so the branch keys on the PRODUCT: a product id that
  // matches none of the four package products falls through untouched, and the subscription
  // handling below stays exactly as it was.
  if (event.type === 'order.paid') {
    const order = event.data as unknown as {
      id?: string
      product_id?: string
      metadata?: { albumId?: string }
    }
    const grant = packageGrantForProduct(order?.product_id)
    if (!grant) {
      // A subscription's order, or a product this build does not know. The subscription's own
      // lifecycle events carry the entitlement, so this is an acknowledgement, not a drop.
      return NextResponse.json({ ok: true, ignored: 'order for non-package product' }, { headers: NO_STORE })
    }
    if (!order.id) {
      return NextResponse.json({ error: 'Missing order id' }, { status: 400, headers: NO_STORE })
    }

    const albumId = order.metadata?.albumId
    if (!albumId || !UUID_RE.test(albumId)) {
      // Paid, and we cannot say for which album. 500, not 200 — the same reasoning as the
      // unknown-product branch below: a 200 stops Polar retrying and the only trace of a real
      // payment is a log line. Retries cover a transient bug; the permanent ones land in front
      // of someone with the order id attached.
      console.error('[polar/webhook] package order without a usable albumId:', order.id)
      reportServerError('polar-webhook', 'Package PAID but no album to apply it to', {
        context: { orderId: order.id, product: grant.label },
      })
      return NextResponse.json({ error: 'no_album_in_metadata' }, { status: 500, headers: NO_STORE })
    }

    const admin = createAdminClient()
    const { data: album, error: albumErr } = await admin
      .from('albums')
      .select('id, package_tier, package_expires_at, package_last_order_id')
      .eq('id', albumId)
      .is('retired_at', null)
      .maybeSingle<{
        id: string
        package_tier: 'pro' | 'studio' | null
        package_expires_at: string | null
        package_last_order_id: string | null
      }>()

    if (albumErr) {
      console.error('[polar/webhook] album lookup failed for package order:', albumErr.message)
      return NextResponse.json({ error: 'album_lookup_failed' }, { status: 500, headers: NO_STORE })
    }
    if (!album) {
      // Paid for an album that is gone — deleted or retired between checkout and webhook. Money
      // for nothing is a support case, not a silent log line.
      reportServerError('polar-webhook', 'Package PAID for an album that no longer exists', {
        context: { orderId: order.id, albumId, product: grant.label },
      })
      return NextResponse.json({ error: 'album_gone' }, { status: 500, headers: NO_STORE })
    }

    // THE SAME ORDER, DELIVERED AGAIN, MUST NOT ADD A SECOND YEAR. Polar redelivers until it gets
    // a 200 and re-sends when unsure; the order id is the idempotency key. Two DIFFERENT orders
    // both count — that is somebody buying two renewals, which is two real years.
    if (album.package_last_order_id === order.id) {
      return NextResponse.json({ ok: true, already: order.id }, { headers: NO_STORE })
    }

    const next = applyPackageGrant(
      { tier: album.package_tier, expiresAt: album.package_expires_at },
      grant,
      new Date(),
    )

    // The order-id predicate repeats in the WHERE so two concurrent deliveries of the same event
    // cannot both apply: the loser matches zero rows, and zero rows is success here — the winner
    // already did the work.
    const { error: updErr } = await admin
      .from('albums')
      .update({ ...next, package_last_order_id: order.id })
      .eq('id', album.id)
      .or(`package_last_order_id.is.null,package_last_order_id.neq.${order.id}`)

    if (updErr) {
      console.error('[polar/webhook] package apply failed:', updErr.message)
      return NextResponse.json({ error: 'apply_failed' }, { status: 500, headers: NO_STORE })
    }

    console.info(`[polar/webhook] ${grant.label} applied to album ${album.id} until ${next.package_expires_at}`)
    track({ name: grant.kind === 'package' ? 'package_purchased' : 'package_renewed', albumId: album.id, product: grant.key })
    return NextResponse.json({ ok: true, applied: grant.key }, { headers: NO_STORE })
  }

  // Only act on subscription lifecycle events. Other events (order.created, etc.) are
  // acknowledged 200 so Polar doesn't retry them — they're not errors.
  if (!event.type?.startsWith('subscription.')) {
    return NextResponse.json({ ok: true, ignored: event.type }, { headers: NO_STORE })
  }

  const sub = event.data
  if (!sub?.id) {
    return NextResponse.json({ error: 'Missing subscription data' }, { status: 400, headers: NO_STORE })
  }

  // Resolve the account. Preferred: the userId the app attaches at in-app checkout. Fallback: link
  // by the Polar customer's email (out-of-flow purchases — e.g. a direct Polar link — carry no
  // userId; without this fallback the payment is silently dropped and never appears in the app).
  let userId = sub.metadata?.userId
  if (!userId || !UUID_RE.test(userId)) {
    const email = sub.customer?.email ?? (sub.customer_id ? await getCustomerEmail(sub.customer_id) : null)
    userId = email ? (await findOrCreateUserByEmail(email)) ?? undefined : undefined
    if (userId) console.warn('[polar/webhook] linked by email (no userId metadata):', sub.id)
  }
  if (!userId) {
    console.error('[polar/webhook] could not resolve a user for subscription:', sub.id)
    // 500, not 200 — same reasoning as the unknown-product branch below. A 200 tells Polar the
    // event is handled and it stops retrying, so a customer who paid gets nothing and the only
    // trace is a log line. Failing loudly lets Polar's retry schedule cover a transient lookup
    // problem, and puts the permanent ones in front of someone.
    reportServerError('polar-webhook', 'Could not resolve a user for a paid subscription', {
      context: { event: event.type, subscription: sub.id },
    })
    return NextResponse.json({ error: 'no_user_resolved' }, { status: 500, headers: NO_STORE })
  }

  const tierMatch = tierFromProduct(sub.product_id)
  if (!tierMatch) {
    // 500, not 200. A 200 tells Polar the event was handled and it never retries -- so a product
    // rotated in Polar, or a POLAR_PRODUCT_* variable missing from the Worker, silently swallows a
    // real payment: the customer is charged, gets no access, and the only trace is a console line
    // nobody reads. Failing loudly lets Polar's own retry schedule cover the configuration gap
    // while it is fixed, which is exactly what that retry exists for.
    console.error('[polar/webhook] unknown product_id (check POLAR_PRODUCT_* secrets):', sub.product_id)
    reportServerError('polar-webhook', 'Unknown Polar product — a payment could not be applied', {
      context: { productId: sub.product_id, event: event.type },
    })
    return NextResponse.json({ error: 'unknown_product' }, { status: 500, headers: NO_STORE })
  }

  const admin = createAdminClient()

  // Robust write that does NOT depend on the table's id default (the live table drifted and has
  // none): explicit UUID on insert, update on an existing row — never touching the primary key.
  const fields = {
    user_id: userId,
    polar_subscription_id: sub.id,
    polar_customer_id: sub.customer_id ?? '',
    polar_product_id: sub.product_id,
    tier: tierMatch.tier,
    status: sub.status,
    current_period_end: sub.current_period_end,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    updated_at: new Date().toISOString(),
    // Polar's own clock, filled in below when the event carries one. Declared here so the object's
    // type admits it — the DB trigger owns updated_at, this column is the one we control.
    polar_modified_at: null as string | null,
  }

  const { data: existing } = await admin
    .from('subscriptions')
    .select('id, polar_modified_at')
    .eq('polar_subscription_id', sub.id)
    .maybeSingle<{ id: string; polar_modified_at: string | null }>()

  // Ignore an event that is OLDER than what we have already applied.
  //
  // Polar retries failed deliveries, so a retried event can arrive after a newer one. Without an
  // ordering check the write was last-writer-wins on arrival order: a stale `canceled` landing after
  // a fresh `active` cuts off a customer who is paying, and a stale `active` after a `canceled`
  // grants access to someone who is not. Both are silent.
  //
  // Compared against POLAR's clock on both sides, in a column of its own.
  //
  // This first read subscriptions.updated_at, which cannot work: a BEFORE UPDATE trigger overwrites
  // that with now() on every write, so the comparison was against OUR processing time. Polar emits
  // bursts — an update, then a cancellation a second later — and we take seconds to process the
  // first, so the second arrived "older" than our own stamp and was discarded with a 200. Polar
  // then never retries. The guard was dropping real cancellations rather than stale duplicates.
  const eventAt = sub.modified_at ? Date.parse(sub.modified_at) : NaN
  const appliedAt = existing?.polar_modified_at ? Date.parse(existing.polar_modified_at) : NaN
  if (existing && Number.isFinite(eventAt) && Number.isFinite(appliedAt) && eventAt < appliedAt) {
    console.warn('[polar/webhook] ignoring out-of-order event', event.type, sub.id, sub.modified_at, '<', existing.polar_modified_at)
    return NextResponse.json({ ok: true, skipped: 'stale_event' }, { headers: NO_STORE })
  }
  // Their timestamp, in their column, so the comparison above means something next time.
  if (Number.isFinite(eventAt)) fields.polar_modified_at = new Date(eventAt).toISOString()

  const { error } = existing
    ? await admin.from('subscriptions').update(fields).eq('polar_subscription_id', sub.id)
    : await admin.from('subscriptions').insert({ id: randomUUID(), ...fields })

  if (error) {
    console.error('[polar/webhook] write failed:', error.message, 'event=', event.type)
    reportServerError('polar-webhook', 'Subscription write failed', { context: { event: event.type, reason: error.message.slice(0, 120) } })
    return NextResponse.json({ error: 'DB write failed' }, { status: 500, headers: NO_STORE })
  }

  // A real Polar row now exists for this user — clear any manual-recovery placeholder, otherwise a
  // stale "active" placeholder could keep granting access after the real subscription is canceled.
  await admin.from('subscriptions')
    .delete().eq('user_id', userId).like('polar_subscription_id', 'manual-recovery-%')

  if (sub.status === 'active' || sub.status === 'trialing') {
    track({ name: 'subscription_active', userId, tier: tierMatch.tier })
  } else if (sub.status === 'canceled') {
    track({ name: 'subscription_canceled', userId, tier: tierMatch.tier })
  }

  return NextResponse.json({ ok: true, type: event.type }, { headers: NO_STORE })
}
