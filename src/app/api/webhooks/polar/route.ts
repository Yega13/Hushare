import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyWebhookSignature, tierFromProduct } from '@/lib/polar'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

type PolarSubscription = {
  id: string
  status: string
  customer_id: string
  product_id: string
  current_period_end: string | null
  cancel_at_period_end?: boolean
  ended_at?: string | null
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

  const userId = sub.metadata?.userId
  if (!userId) {
    console.error('[polar/webhook] subscription has no userId metadata:', sub.id)
    return NextResponse.json({ ok: true, error: 'no_user_metadata' }, { headers: NO_STORE })
  }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(userId)) {
    console.error('[polar/webhook] userId metadata is not a valid UUID:', sub.id, userId)
    return NextResponse.json({ ok: true, error: 'invalid_user_metadata' }, { headers: NO_STORE })
  }

  const tierMatch = tierFromProduct(sub.product_id)
  if (!tierMatch) {
    console.error('[polar/webhook] unknown product_id:', sub.product_id)
    return NextResponse.json({ ok: true, error: 'unknown_product' }, { headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('subscriptions')
    .upsert(
      {
        user_id: userId,
        polar_subscription_id: sub.id,
        polar_customer_id: sub.customer_id,
        polar_product_id: sub.product_id,
        tier: tierMatch.tier,
        status: sub.status,
        current_period_end: sub.current_period_end,
        cancel_at_period_end: sub.cancel_at_period_end ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'polar_subscription_id' },
    )

  if (error) {
    console.error('[polar/webhook] upsert failed:', error.message, 'event=', event.type)
    return NextResponse.json({ error: 'DB write failed' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, type: event.type }, { headers: NO_STORE })
}
