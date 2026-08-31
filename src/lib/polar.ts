import { timingSafeEqual } from '@/lib/timing-safe'
import { PLAN_CATALOGUE, formatPrice } from '@/lib/plan-catalogue'
import { PACKAGE_CATALOGUE, RENEWAL_CATALOGUE } from '@/lib/package-catalogue'

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
export type DiscountHealth = {
  plan: string
  id: string | null
  state: 'ok' | 'missing' | 'unset' | 'unknown'
  /** WHY it could not be checked, in words the owner can act on. Only set when state is 'unknown'.
   *  Without this the panel says "Polar did not answer, or the key is expired or unscoped" — three
   *  different problems with three different fixes, and no way to tell which one you have. */
  why?: string
}

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
      // longer has. 422 is the same answer in a different costume — it is literally what checkout
      // creation returned ("Discount does not exist") while THIS probe stayed quiet, so treating
      // 422 as unanswerable is how three customers were charged full price with a green panel.
      if (res.status === 404 || res.status === 422) return { plan, id, state: 'missing' }
      // Everything else is a question we could not ask, not a dead discount. 401/403 in particular
      // mean OUR key is wrong or unscoped; blaming the discount there would send the owner into the
      // Polar dashboard to fix something that is not broken (rule 19 — say which way it errs).
      if (res.status === 401) {
        return { plan, id, state: 'unknown', why: 'our Polar API key was rejected (401) — it is expired or revoked' }
      }
      if (res.status === 403) {
        // The most likely one, and the least obvious: a key that creates checkouts fine but was
        // never given permission to READ discounts. Sales keep working, so nothing looks wrong.
        return { plan, id, state: 'unknown', why: 'our Polar API key is not allowed to read discounts (403) — add the discounts:read scope to it' }
      }
      if (!res.ok) return { plan, id, state: 'unknown', why: `Polar answered ${res.status}` }
      return { plan, id, state: 'ok' }
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      return { plan, id, state: 'unknown', why: timedOut ? 'Polar did not answer within 4 seconds' : 'could not reach Polar' }
    }
  }))
}


// ── Does Polar charge what we advertise? ──────────────────────────────────────
//
// Same reasoning as checkIntroDiscounts, for the bigger number. A product's billing INTERVAL
// cannot be edited at Polar after creation, so a mis-created product stays wrong until someone
// notices — and "Hushare Studio (Yearly)" was configured to charge $100 every MONTH while
// /pricing advertised $100 a year. No one had bought it, so nothing was broken yet; the first
// annual Max customer would have paid $1,200 for a $100 plan.
//
// Compares every plan against PLAN_CATALOGUE. Read-only, and a lookup that fails reports
// nothing rather than accusing a correct product.
export type PlanHealth = {
  plan: string
  state: 'ok' | 'wrong-interval' | 'wrong-price' | 'missing' | 'unset' | 'unknown'
  detail?: string
}

// One product checked against what we sell it as. Shared by the subscription and package checks,
// because the fetch, the 404 logic and the price comparison must not exist twice (rule 13).
//
// `wantInterval: null` means the product must be a ONE-TIME purchase. That check exists because
// its failure already happened in both directions here: "Hushare Studio (Yearly)" was created at
// Polar as $100 every MONTH, and a package created as recurring would quietly bill $49 every
// month for something sold as buy-once. Polar cannot edit an interval after creation, so the only
// fix is recreation — all the more reason the panel says it before a customer does.
async function checkOnePolarProduct(
  label: string,
  envVar: string,
  wantCents: number,
  wantInterval: 'month' | 'year' | null,
): Promise<PlanHealth> {
  const id = process.env[envVar]
  if (!id) return { plan: label, state: 'unset' }
  try {
    const res = await fetch(`${apiBase()}/v1/products/${id}`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    if (res.status === 404) return { plan: label, state: 'missing' }
    if (!res.ok) return { plan: label, state: 'unknown' }
    const product = await res.json() as {
      recurring_interval?: string | null
      prices?: Array<{ price_amount?: number | null; recurring_interval?: string | null }>
    }
    const price = product.prices?.[0]
    // The interval can live on either the product or its price depending on how it was
    // created; a product is only correct if whichever one Polar reports agrees with ours.
    const interval = price?.recurring_interval ?? product.recurring_interval ?? null
    if (wantInterval === null && interval) {
      return { plan: label, state: 'wrong-interval', detail: `sold as buy-once, but Polar charges every ${interval}` }
    }
    if (wantInterval !== null && interval && interval !== wantInterval) {
      return { plan: label, state: 'wrong-interval', detail: `Polar charges every ${interval}` }
    }
    const cents = price?.price_amount
    if (typeof cents === 'number' && cents !== wantCents) {
      return { plan: label, state: 'wrong-price', detail: `Polar charges ${formatPrice(cents)}` }
    }
    return { plan: label, state: 'ok' }
  } catch {
    return { plan: label, state: 'unknown' }
  }
}

export async function checkPlanProducts(): Promise<PlanHealth[]> {
  return Promise.all(Object.values(PLAN_CATALOGUE).map((want) =>
    checkOnePolarProduct(want.label, want.envVar, want.amountCents, want.interval)))
}

// The four one-time package products, held to the closed prices in package-catalogue.
export async function checkPackageProducts(): Promise<PlanHealth[]> {
  return Promise.all([
    ...Object.values(PACKAGE_CATALOGUE).map((want) =>
      checkOnePolarProduct(want.label, want.envVar, want.amountCents, null)),
    ...Object.values(RENEWAL_CATALOGUE).map((want) =>
      checkOnePolarProduct(want.label, want.envVar, want.amountCents, null)),
  ])
}
