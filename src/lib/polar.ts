import { timingSafeEqual } from '@/lib/timing-safe'

const PROD_BASE = 'https://api.polar.sh'
const SANDBOX_BASE = 'https://sandbox-api.polar.sh'

function apiBase(): string {
  return process.env.POLAR_SANDBOX === 'true' ? SANDBOX_BASE : PROD_BASE
}

function apiKey(): string {
  const key = process.env.POLAR_API_KEY
  if (!key) throw new Error('POLAR_API_KEY not set')
  return key
}

export type CheckoutInput = {
  productId: string
  successUrl: string
  customerEmail: string
  metadata: { userId: string; tier: 'pro' | 'studio'; cycle: 'monthly' | 'yearly' }
  discountId?: string
}

export type CheckoutResult = {
  id: string
  url: string
}

export async function createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const body: Record<string, unknown> = {
    products: [input.productId],
    success_url: input.successUrl,
    customer_email: input.customerEmail,
    metadata: input.metadata,
  }
  if (input.discountId) body.discount_id = input.discountId

  const res = await fetch(`${apiBase()}/v1/checkouts/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[polar] checkout failed:', res.status, text.slice(0, 200))
    throw new Error(`Polar checkout creation failed: ${res.status}`)
  }

  const data = (await res.json()) as { id: string; url: string }
  if (!data.url) {
    console.error('[polar] checkout response missing url:', JSON.stringify(data).slice(0, 200))
    throw new Error('Polar checkout response missing url')
  }
  return { id: data.id, url: data.url }
}

export async function createCustomerSession(customerId: string): Promise<string> {
  const res = await fetch(`${apiBase()}/v1/customer-sessions/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ customer_id: customerId }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[polar] customer session failed:', res.status, text.slice(0, 200))
    throw new Error(`Polar customer session creation failed: ${res.status}`)
  }

  const data = (await res.json()) as { customer_portal_url: string }
  return data.customer_portal_url
}

export async function verifyWebhookSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
): Promise<boolean> {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatureHeader = headers.get('webhook-signature')

  if (!id || !timestamp || !signatureHeader) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false

  const keyMaterial = new TextEncoder().encode(secret)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signedContent = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`)
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, signedContent)
  const expected = Buffer.from(sig).toString('base64')

  const candidates = signatureHeader
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith('v1,') ? s.slice(3) : s))

  // Evaluate ALL candidates — .some() short-circuits and leaks timing on multi-candidate headers
  let match = false
  for (const candidate of candidates) {
    if (timingSafeEqual(candidate, expected)) match = true
  }
  return match
}

type ProductMap = Record<string, { tier: 'pro' | 'studio'; cycle: 'monthly' | 'yearly' }>

function getProductMap(): ProductMap {
  const proMonthly = process.env.POLAR_PRODUCT_PRO_MONTHLY
  const proYearly = process.env.POLAR_PRODUCT_PRO_YEARLY
  const studioMonthly = process.env.POLAR_PRODUCT_STUDIO_MONTHLY
  const studioYearly = process.env.POLAR_PRODUCT_STUDIO_YEARLY

  const map: ProductMap = {}
  if (proMonthly) map[proMonthly] = { tier: 'pro', cycle: 'monthly' }
  if (proYearly) map[proYearly] = { tier: 'pro', cycle: 'yearly' }
  if (studioMonthly) map[studioMonthly] = { tier: 'studio', cycle: 'monthly' }
  if (studioYearly) map[studioYearly] = { tier: 'studio', cycle: 'yearly' }
  return map
}

export function tierFromProduct(productId: string): { tier: 'pro' | 'studio'; cycle: 'monthly' | 'yearly' } | null {
  const result = getProductMap()[productId] ?? null
  if (!result) {
    console.warn('[polar] unknown productId in webhook — check POLAR_PRODUCT_* env vars:', productId)
  }
  return result
}

// ─── Stable plan keys ──────────────────────────────────────────────────────────
// The pricing page bakes a plan key (e.g. "pro_monthly") into its HTML instead of a raw Polar
// product ID. That HTML is CDN/browser-cached for 24h (see next.config.ts Cache-Control on
// /pricing), so if it embedded the actual product ID, rotating a Polar product or fixing a
// misconfigured secret would silently break checkout for anyone holding a stale cached copy —
// exactly what happened in production. A plan key is not a secret and never changes; the actual
// product ID is resolved from env HERE, at checkout-POST time (never cached), so a live secret
// change takes effect on the very next click regardless of how stale the pricing page's cache is.
export type PlanKey = 'pro_monthly' | 'pro_yearly' | 'studio_monthly' | 'studio_yearly'

const PLAN_ENV_KEYS: Record<PlanKey, string> = {
  pro_monthly: 'POLAR_PRODUCT_PRO_MONTHLY',
  pro_yearly: 'POLAR_PRODUCT_PRO_YEARLY',
  studio_monthly: 'POLAR_PRODUCT_STUDIO_MONTHLY',
  studio_yearly: 'POLAR_PRODUCT_STUDIO_YEARLY',
}

export function isPlanKey(v: string): v is PlanKey {
  return Object.prototype.hasOwnProperty.call(PLAN_ENV_KEYS, v)
}

export function productIdForPlan(
  plan: string,
): { productId: string; tier: 'pro' | 'studio'; cycle: 'monthly' | 'yearly' } | null {
  if (!isPlanKey(plan)) return null
  const productId = process.env[PLAN_ENV_KEYS[plan]]
  if (!productId) {
    console.warn('[polar] plan requested but its product ID env var is not set:', plan, PLAN_ENV_KEYS[plan])
    return null
  }
  const [tier, cycle] = plan.split('_') as ['pro' | 'studio', 'monthly' | 'yearly']
  return { productId, tier, cycle }
}
