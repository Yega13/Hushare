import { NextResponse } from 'next/server'
import { reportServerError } from '@/lib/report-server-error'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyWebhookSignature, tierFromProduct, getCustomerEmail, getOrder } from '@/lib/polar'
import { findOrCreateUserByEmail } from '@/lib/provision-user'
import { track } from '@/lib/analytics'
import { packageGrantForProduct, applyPackageGrant, orderAmountLooksPaid, refundOutcome } from '@/lib/package-purchase'
import { PACKAGE_CATALOGUE, RENEWAL_CATALOGUE, type PackageKey, type RenewalKey } from '@/lib/package-catalogue'

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
      // What was actually collected. Polar names the post-discount, post-refund figure net_amount;
      // total_amount is the gross. Both are read so a build against either shape still verifies,
      // and the SMALLER is used — the question is "did the money arrive", not "was it invoiced".
      net_amount?: number
      total_amount?: number
      amount?: number
      metadata?: { albumId?: string; userId?: string }
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
      .select('id, user_id, package_tier, package_expires_at, package_last_order_id')
      .eq('id', albumId)
      .is('retired_at', null)
      .maybeSingle<{
        id: string
        user_id: string | null
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

    // WHAT WAS ACTUALLY PAID, against what the catalogue advertises. Without this the grant was
    // decided by product id alone, and Polar's checkout offers a promo-code field we never turned
    // off — so a discounted or free order bought a full two-year grant. A shortfall is reported and
    // refused rather than silently honoured; an amount Polar did not send is reported and ALLOWED,
    // because refusing a signature-verified purchase over a missing field would break real
    // customers to stop a hypothetical one (rule 19 — and here the safe direction is to let the
    // paying customer through and tell ourselves about it).
    const expectedCents = grant.kind === 'package'
      ? PACKAGE_CATALOGUE[grant.key as PackageKey].amountCents
      : RENEWAL_CATALOGUE[grant.key as RenewalKey].amountCents
    const paidCandidates = [order.net_amount, order.total_amount, order.amount]
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    const paidCents = paidCandidates.length ? Math.min(...paidCandidates) : null
    const paidCheck = orderAmountLooksPaid(expectedCents, paidCents)
    if (!paidCheck.ok && paidCheck.reason === 'short') {
      console.error(`[polar/webhook] ${grant.label} paid ${paidCents} of ${expectedCents} — not granting`)
      reportServerError('polar-webhook', 'Package order paid LESS than the advertised price', {
        context: { orderId: order.id, albumId, product: grant.label, expectedCents, paidCents },
      })
      return NextResponse.json({ error: 'amount_short' }, { status: 400, headers: NO_STORE })
    }
    if (!paidCheck.ok) {
      reportServerError('polar-webhook', 'Package order carried no amount — granted unverified', {
        context: { orderId: order.id, albumId, product: grant.label, expectedCents },
      })
    }

    const next = applyPackageGrant(
      { tier: album.package_tier, expiresAt: album.package_expires_at },
      grant,
      new Date(),
    )

    // PAYMENT CLAIMS THE ALBUM. Checkout requires a signed-in buyer, so if the album is still
    // anonymous the buyer in the metadata becomes its owner — the album cap deliberately does not
    // apply here (packaged albums are excluded from it), so nothing can strand a paid album off
    // its buyer's account. An album that already HAS an owner is never re-owned: a package is a
    // gift anyone holding the owner link may add, not a way to take the album.
    const buyerId = order.metadata?.userId
    const claim = !album.user_id && buyerId && UUID_RE.test(buyerId) ? { user_id: buyerId } : {}

    // COMPARE-AND-SWAP ON THE EXPIRY WE READ. `next` was computed in JS from the row above, so
    // whoever writes last wins — and with two DIFFERENT orders in flight at once (a double
    // purchase, or Polar retrying two orders together) both read the same expiry, both add a year
    // to it, and one paid year silently disappears while both callers get a 200. The order-id
    // predicate alone does not catch that: it only excludes the SAME order.
    //
    // So the UPDATE also requires the expiry to still be exactly what we based the sum on. If
    // anything moved underneath us the WHERE matches nothing, and this returns 500 so Polar
    // redelivers — the retry re-reads the new expiry and stacks its year on top of it.
    const casExpiry = album.package_expires_at
    let q = admin
      .from('albums')
      .update({ ...next, ...claim, package_last_order_id: order.id })
      .eq('id', album.id)
    // The order-id predicate is belt-and-braces on top of the CAS, and it is INTERPOLATED into a
    // PostgREST filter — a comma or paren in an id would rewrite the filter into something else.
    // Checked against the live database: every real Polar id is a UUID (the only non-UUID row is a
    // comp subscription we wrote ourselves). A surprise still must not cost anyone their package,
    // so an unexpected shape drops this predicate rather than refusing the payment: the CAS below
    // already makes double-application impossible on its own (rule 19 — the uncertain branch gives
    // up the extra guard, never the money).
    if (UUID_RE.test(order.id)) {
      q = q.or(`package_last_order_id.is.null,package_last_order_id.neq.${order.id}`)
    }
    q = casExpiry === null ? q.is('package_expires_at', null) : q.eq('package_expires_at', casExpiry)
    // Read the write back: without this, "no error" also covers "matched zero rows", which is how
    // an album deleted between the SELECT and the UPDATE would take the money, log success, and
    // return a 200 that stops Polar ever retrying.
    const { data: applied, error: updErr } = await q.select('id')

    if (updErr) {
      console.error('[polar/webhook] package apply failed:', updErr.message)
      return NextResponse.json({ error: 'apply_failed' }, { status: 500, headers: NO_STORE })
    }
    if (!applied || applied.length === 0) {
      // Nothing matched: the row changed under us, or it is gone. Never a success — 500 asks Polar
      // to redeliver, and the retry either short-circuits on the order id (somebody else applied
      // this very order) or recomputes from the current expiry. Reported because a package that
      // needs a retry to land is worth seeing even when the retry works.
      console.error('[polar/webhook] package apply matched no rows:', order.id)
      reportServerError('polar-webhook', 'Package PAID but the apply matched no rows', {
        context: { orderId: order.id, albumId: album.id, product: grant.label },
      })
      return NextResponse.json({ error: 'apply_raced' }, { status: 500, headers: NO_STORE })
    }

    // RECORD THE ORDER IN THE LEDGER, so the nightly reconcile knows this one was honoured.
    //
    // package_last_order_id holds ONE id, so as soon as a second order lands on this album the
    // first stops looking applied — and the reconcile, which re-reads historical orders, would
    // grant it again every night forever. The ledger is the set of orders already turned into
    // entitlement; without this write the repair job cannot tell "the webhook handled it" from
    // "the webhook was lost", and it defaults to granting.
    //
    // AFTER the grant, deliberately: if this insert fails, the customer still has what they paid
    // for and the worst case is a duplicate grant the reconcile's compare-and-swap has to catch.
    // Doing it first would risk the reverse — a recorded order that was never actually granted.
    const { error: ledgerErr } = await admin
      .from('package_order_grants')
      .upsert({ order_id: order.id, album_id: album.id, source: 'webhook' },
        { onConflict: 'order_id', ignoreDuplicates: true })
    if (ledgerErr) {
      console.error('[polar/webhook] ledger write failed:', ledgerErr.message)
      reportServerError('polar-webhook', 'Package applied but NOT recorded in the order ledger', {
        context: { orderId: order.id, albumId: album.id, detail: ledgerErr.message.slice(0, 200) },
      })
    }

    console.info(`[polar/webhook] ${grant.label} applied to album ${album.id} until ${next.package_expires_at}`)
    track({ name: grant.kind === 'package' ? 'package_purchased' : 'package_renewed', albumId: album.id, product: grant.key })
    return NextResponse.json({ ok: true, applied: grant.key }, { headers: NO_STORE })
  }

  // ── A REFUNDED PACKAGE IS NOT A PACKAGE ─────────────────────────────────────
  //
  // These events were acknowledged and dropped, so "buy a $99 Max Package, ask Polar for a refund,
  // keep the album" worked — once per album, for anyone who tried it. Subscriptions were covered
  // only by accident (a refund usually cancels the subscription, and isSubActive then expires it);
  // a package is a tier and a date on one row with no lifecycle behind it, so nothing took it back.
  //
  // Only the order that GRANTED the package may revoke it, and only a refund of substantially the
  // WHOLE order revokes anything — see refundOutcome. A refund of an earlier order must never strip
  // time a later order has since paid for, and a partial refund must never strip anything at all.
  if (event.type === 'order.refunded' || event.type === 'refund.created') {
    const refund = event.data as unknown as { order_id?: string; id?: string }
    const orderId = refund?.order_id ?? refund?.id
    if (!orderId) {
      return NextResponse.json({ ok: true, ignored: 'refund without an order id' }, { headers: NO_STORE })
    }
    const admin = createAdminClient()
    const { data: album, error: lookupErr } = await admin
      .from('albums')
      .select('id, package_tier, package_expires_at, package_last_order_id')
      .eq('package_last_order_id', orderId)
      .maybeSingle<{
        id: string
        package_tier: 'pro' | 'studio' | null
        package_expires_at: string | null
        package_last_order_id: string | null
      }>()
    if (lookupErr) {
      // 500 so Polar retries: silently keeping a refunded package is the failure this branch exists
      // to prevent, and a lookup that failed has not answered the question.
      console.error('[polar/webhook] refund lookup failed:', lookupErr.message)
      return NextResponse.json({ error: 'refund_lookup_failed' }, { status: 500, headers: NO_STORE })
    }
    if (!album) {
      // A refunded subscription order, or a package already superseded by a later purchase.
      return NextResponse.json({ ok: true, ignored: 'refund matches no package' }, { headers: NO_STORE })
    }
    // HOW MUCH WENT BACK, asked of the ORDER rather than of this event.
    //
    // A refund.created payload describes ONE refund and carries no order total, so it cannot answer
    // "is this purchase cancelled or is this a $1 goodwill credit" — and two $50 refunds against a
    // $99 order are a full refund that neither event states alone. Only the order's cumulative
    // refunded_amount against its total says so. An order.refunded payload IS the order and already
    // carries both, so it is used directly and no extra call is made.
    const eventOrder = event.data as unknown as { refunded_amount?: number; total_amount?: number; net_amount?: number }
    const haveAmounts = typeof eventOrder?.refunded_amount === 'number'
      && (typeof eventOrder?.total_amount === 'number' || typeof eventOrder?.net_amount === 'number')
    const order = haveAmounts ? eventOrder : await getOrder(orderId)
    if (!order) {
      // Could not ask Polar. 500 so it retries rather than guessing: revoking on a failed lookup
      // would take a paying customer's album away because a network call timed out.
      console.error('[polar/webhook] refund: could not fetch order', orderId)
      return NextResponse.json({ error: 'refund_order_fetch_failed' }, { status: 500, headers: NO_STORE })
    }

    const outcome = refundOutcome(
      { tier: album.package_tier, expiresAt: album.package_expires_at, lastOrderId: album.package_last_order_id },
      orderId,
      { totalCents: order.total_amount ?? order.net_amount, refundedCents: order.refunded_amount },
    )
    if (outcome.action === 'keep') {
      // A partial refund against a live package is a customer conversation, not a silent skip: we
      // chose to send money back and deliberately did NOT take the features, so somebody should
      // know. 'unknown' is louder still — it means the amounts could not be read at all, and the
      // safe direction was taken on purpose.
      if (outcome.reason === 'partial' || outcome.reason === 'unknown') {
        reportServerError('polar-webhook', `Refund on a paid package — package KEPT (${outcome.reason})`, {
          context: { orderId, albumId: album.id, tier: album.package_tier, reason: outcome.reason },
        })
      }
      return NextResponse.json({ ok: true, ignored: outcome.reason }, { headers: NO_STORE })
    }
    const { error: updErr } = await admin
      .from('albums')
      .update(outcome.update)
      .eq('id', album.id)
      .eq('package_last_order_id', orderId)
    if (updErr) {
      console.error('[polar/webhook] refund revoke failed:', updErr.message)
      return NextResponse.json({ error: 'revoke_failed' }, { status: 500, headers: NO_STORE })
    }
    // Loud on purpose: money went back and an album lost its paid features. That is a customer
    // conversation, not a log line — the album keeps every photo (retirement checks activity, not
    // this), but Face Finder and the rest switch off and somebody may ask why.
    reportServerError('polar-webhook', 'Package REFUNDED — entitlement revoked', {
      context: { orderId, albumId: album.id, wasTier: album.package_tier },
    })
    console.info(`[polar/webhook] refund ${orderId} revoked the package on album ${album.id}`)
    return NextResponse.json({ ok: true, revoked: album.id }, { headers: NO_STORE })
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
