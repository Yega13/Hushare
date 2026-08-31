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
    // The BODY rides in the error. A bare "422" cost a debugging round trip through a customer:
    // Polar's body names the exact invalid field (a dead discount id, a detached product), and
    // console.error alone goes to a log stream nobody reads.
    throw new Error(`Polar checkout creation failed: ${res.status} ${text.slice(0, 180)}`)
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

// Fetch a Polar customer's email by id. Used by the webhook to link an out-of-flow payment (one
// made without the app's userId metadata, e.g. via a direct Polar checkout link) to an account.
export async function getCustomerEmail(customerId: string): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase()}/v1/customers/${customerId}`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
    })
    if (!res.ok) {
      console.error('[polar] getCustomerEmail failed:', res.status)
      return null
    }
    const data = (await res.json()) as { email?: string }
    return data.email ?? null
  } catch (err) {
    console.error('[polar] getCustomerEmail threw:', err instanceof Error ? err.message : String(err))
    return null
  }
}

// Polar's list API nests product/customer as objects; the webhook payload uses flat *_id fields.
// Accept BOTH so the reconcile is robust to either shape.
export type PolarSubscriptionItem = {
  id: string
  status: string
  current_period_end: string | null
  cancel_at_period_end?: boolean
  product_id?: string | null
  product?: { id?: string | null } | null
  customer_id?: string | null
  customer?: { id?: string | null; email?: string | null } | null
  metadata?: { userId?: string } | null
}

// Normalise either shape to the flat ids we need.
export function subProductId(sub: PolarSubscriptionItem): string | null {
  return sub.product_id ?? sub.product?.id ?? null
}
export function subCustomerId(sub: PolarSubscriptionItem): string | null {
  return sub.customer_id ?? sub.customer?.id ?? null
}

// Pull ALL subscriptions from Polar (paginated). Used by the admin "Sync from Polar" reconcile to
// backfill payments the webhook missed — works regardless of webhook delivery/registration.
export async function listAllSubscriptions(): Promise<PolarSubscriptionItem[]> {
  const out: PolarSubscriptionItem[] = []
  for (let page = 1; page <= 50; page++) {
    const url = new URL(`${apiBase()}/v1/subscriptions/`)
    url.searchParams.set('limit', '100')
    url.searchParams.set('page', String(page))
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${apiKey()}` } })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Polar list subscriptions failed: ${res.status} ${text.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      items?: PolarSubscriptionItem[]
      pagination?: { max_page?: number; total_count?: number }
    }
    const items = data.items ?? []
    out.push(...items)
    const maxPage = data.pagination?.max_page ?? 1
    if (items.length === 0 || page >= maxPage) break
  }
  return out
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

// ── Are the advertised intro discounts actually alive at Polar? ───────────────
//
// The pricing page promises "$1.99 first month" in six places across three languages, and that
// promise depends on a discount OBJECT living in someone else's dashboard. When one was deleted,
// nothing here knew: eligible buyers were charged full price, and the only signal was an error
// filed AFTER a customer had already overpaid. A promise this app makes but cannot keep should
// be visible to the owner before a customer discovers it (rule 20's shape, in money).
//
// Read-only. Never repairs anything, and a network failure reports 'unknown' rather than
// claiming a live discount is dead — a false alarm here would send the owner into the Polar
// dashboard to fix nothing.
export type DiscountHealth = { plan: string; id: string | null; state: 'ok' | 'missing' | 'unset' | 'unknown' }

export async function checkIntroDiscounts(): Promise<DiscountHealth[]> {
  const wanted: Array<{ plan: string; id: string | undefined }> = [
    { plan: 'Pro monthly', id: process.env.POLAR_DISCOUNT_PRO_FIRST_MONTH },
    { plan: 'Max monthly', id: process.env.POLAR_DISCOUNT_STUDIO_FIRST_MONTH },
  ]
  return Promise.all(wanted.map(async ({ plan, id }): Promise<DiscountHealth> => {
    if (!id) return { plan, id: null, state: 'unset' }
    try {
      const res = await fetch(`${apiBase()}/v1/discounts/${id}`, {
        headers: { Authorization: `Bearer ${apiKey()}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      })
      // 404 is the answer this exists to catch: the id in our secrets names something Polar no
      // longer has. Any other non-OK status is a question we could not ask, not a dead discount.
      if (res.status === 404) return { plan, id, state: 'missing' }
      if (!res.ok) return { plan, id, state: 'unknown' }
      return { plan, id, state: 'ok' }
    } catch {
      return { plan, id, state: 'unknown' }
    }
  }))
}
