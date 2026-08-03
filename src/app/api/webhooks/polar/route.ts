import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyWebhookSignature, tierFromProduct, getCustomerEmail } from '@/lib/polar'
import { findOrCreateUserByEmail } from '@/lib/provision-user'
import { track } from '@/lib/analytics'

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
    return NextResponse.json({ ok: true, error: 'no_user_resolved' }, { headers: NO_STORE })
  }

  const tierMatch = tierFromProduct(sub.product_id)
  if (!tierMatch) {
    console.error('[polar/webhook] unknown product_id:', sub.product_id)
    return NextResponse.json({ ok: true, error: 'unknown_product' }, { headers: NO_STORE })
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
  }

  const { data: existing } = await admin
    .from('subscriptions')
    .select('id')
    .eq('polar_subscription_id', sub.id)
    .maybeSingle<{ id: string }>()

  const { error } = existing
    ? await admin.from('subscriptions').update(fields).eq('polar_subscription_id', sub.id)
    : await admin.from('subscriptions').insert({ id: randomUUID(), ...fields })

  if (error) {
    console.error('[polar/webhook] write failed:', error.message, 'event=', event.type)
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
