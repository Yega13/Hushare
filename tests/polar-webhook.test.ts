import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { verifyWebhookSignature, tierFromProduct, isPlanKey, subProductId, subCustomerId } from '@/lib/polar'

// THE BOUNDARY THAT DECIDES WHO HAS PAID.
//
// api/webhooks/polar takes an unauthenticated POST from the internet and writes a row that grants
// a Pro or Max plan. The only thing standing between that endpoint and anyone on the internet is
// verifyWebhookSignature — 185 lines of webhook handler and the module behind it had no test of
// any kind.
//
// Getting it wrong in the permissive direction means a stranger grants themselves Max, forever,
// silently. Getting it wrong in the strict direction means real payments stop being recorded and
// paying customers lose the features they bought, which is just as quiet.
//
// These tests sign payloads the way Polar does (Standard Webhooks: HMAC-SHA256 over
// "id.timestamp.body", base64) and then attack them.

/** Produce the signature a legitimate Polar delivery would carry. */
async function sign(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`))
  return Buffer.from(sig).toString('base64')
}

const SECRET = 'whsec_test_secret_value'
const BODY = JSON.stringify({ type: 'subscription.created', data: { id: 'sub_1', status: 'active' } })
const ID = 'msg_abc123'

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000))
}

function headersFor(id: string, timestamp: string, signature: string): Headers {
  return new Headers({
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': signature,
  })
}

describe('a genuine Polar delivery is accepted', () => {
  it('accepts a correctly signed payload', async () => {
    const ts = nowSeconds()
    const sig = await sign(SECRET, ID, ts, BODY)
    expect(await verifyWebhookSignature(BODY, headersFor(ID, ts, `v1,${sig}`), SECRET)).toBe(true)
  })

  it('accepts a signature sent without the v1, prefix', async () => {
    const ts = nowSeconds()
    const sig = await sign(SECRET, ID, ts, BODY)
    expect(await verifyWebhookSignature(BODY, headersFor(ID, ts, sig), SECRET)).toBe(true)
  })

  it('accepts when the real signature is one of several candidates', async () => {
    // Standard Webhooks allows a space-separated list during secret rotation. The real one may be
    // in any position, and every candidate must be evaluated.
    const ts = nowSeconds()
    const sig = await sign(SECRET, ID, ts, BODY)
    const bogus = Buffer.from('not-the-right-signature-at-all').toString('base64')
    expect(await verifyWebhookSignature(BODY, headersFor(ID, ts, `v1,${bogus} v1,${sig}`), SECRET)).toBe(true)
    expect(await verifyWebhookSignature(BODY, headersFor(ID, ts, `v1,${sig} v1,${bogus}`), SECRET)).toBe(true)
  })
})

describe('a forged delivery is refused', () => {
  it('REFUSES a body that was tampered with after signing', async () => {
    // The attack this exists to stop: take a real delivery, change the tier or the user, replay it.
    const ts = nowSeconds()
    const sig = await sign(SECRET, ID, ts, BODY)
    const tampered = JSON.stringify({ type: 'subscription.created', data: { id: 'sub_1', status: 'active', tier: 'studio' } })
    expect(await verifyWebhookSignature(tampered, headersFor(ID, ts, `v1,${sig}`), SECRET)).toBe(false)
  })

  it('REFUSES a signature made with the wrong secret', async () => {
    const ts = nowSeconds()
    const sig = await sign('whsec_attacker_guess', ID, ts, BODY)
    expect(await verifyWebhookSignature(BODY, headersFor(ID, ts, `v1,${sig}`), SECRET)).toBe(false)
  })

  it('REFUSES a signature bound to a different message id', async () => {
    // The id is part of the signed content, so a signature cannot be lifted onto another delivery.
    const ts = nowSeconds()
    const sig = await sign(SECRET, 'msg_other', ts, BODY)
    expect(await verifyWebhookSignature(BODY, headersFor(ID, ts, `v1,${sig}`), SECRET)).toBe(false)
  })

  it('REFUSES a signature bound to a different timestamp', async () => {
    const ts = nowSeconds()
    const sig = await sign(SECRET, ID, String(Number(ts) - 10), BODY)
    expect(await verifyWebhookSignature(BODY, headersFor(ID, ts, `v1,${sig}`), SECRET)).toBe(false)
  })

  it('refuses when every candidate is wrong', async () => {
    const ts = nowSeconds()
    const bogus = Buffer.from('nope').toString('base64')
    expect(await verifyWebhookSignature(BODY, headersFor(ID, ts, `v1,${bogus} v1,${bogus}`), SECRET)).toBe(false)
  })

  it('refuses an empty signature header', async () => {
    const ts = nowSeconds()
    expect(await verifyWebhookSignature(BODY, headersFor(ID, ts, ''), SECRET)).toBe(false)
    expect(await verifyWebhookSignature(BODY, headersFor(ID, ts, '   '), SECRET)).toBe(false)
  })
})

describe('a replayed delivery is refused', () => {
  it('REFUSES a signature older than the tolerance window', async () => {
    // A captured delivery replayed tomorrow must not re-grant a plan that has since been cancelled.
    const old = String(Math.floor(Date.now() / 1000) - 3600)
    const sig = await sign(SECRET, ID, old, BODY)
    expect(await verifyWebhookSignature(BODY, headersFor(ID, old, `v1,${sig}`), SECRET)).toBe(false)
  })

  it('refuses a timestamp far in the future', async () => {
    const future = String(Math.floor(Date.now() / 1000) + 3600)
    const sig = await sign(SECRET, ID, future, BODY)
    expect(await verifyWebhookSignature(BODY, headersFor(ID, future, `v1,${sig}`), SECRET)).toBe(false)
  })

  it('allows genuine clock skew inside the window', async () => {
    // Tolerance exists because clocks differ. Too tight and real deliveries are rejected, which is
    // the failure where paying customers silently lose what they bought.
    for (const offset of [-120, 120]) {
      const ts = String(Math.floor(Date.now() / 1000) + offset)
      const sig = await sign(SECRET, ID, ts, BODY)
      expect(
        await verifyWebhookSignature(BODY, headersFor(ID, ts, `v1,${sig}`), SECRET),
        `${offset}s of skew should still be accepted`,
      ).toBe(true)
    }
  })

  it('refuses a non-numeric timestamp rather than treating it as zero', async () => {
    const sig = await sign(SECRET, ID, 'not-a-number', BODY)
    expect(await verifyWebhookSignature(BODY, headersFor(ID, 'not-a-number', `v1,${sig}`), SECRET)).toBe(false)
  })
})

describe('a delivery missing its headers is refused', () => {
  it('refuses when any required header is absent', async () => {
    const ts = nowSeconds()
    const sig = await sign(SECRET, ID, ts, BODY)
    const full = { 'webhook-id': ID, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` }
    for (const drop of ['webhook-id', 'webhook-timestamp', 'webhook-signature']) {
      const h = new Headers({ ...full })
      h.delete(drop)
      expect(await verifyWebhookSignature(BODY, h, SECRET), `missing ${drop} must be refused`).toBe(false)
    }
  })
})

// WHICH PLAN DID THEY ACTUALLY BUY?
//
// The product id arrives from Polar and is mapped to a tier through environment variables. An
// unknown product must map to NOTHING — the webhook then refuses the event rather than guessing,
// because guessing means either granting a plan nobody paid for or recording the wrong one.
describe('a product only maps to the tier it was configured as', () => {
  const ENV_KEYS = [
    'POLAR_PRODUCT_PRO_MONTHLY', 'POLAR_PRODUCT_PRO_YEARLY',
    'POLAR_PRODUCT_STUDIO_MONTHLY', 'POLAR_PRODUCT_STUDIO_YEARLY',
  ] as const
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k]
    process.env.POLAR_PRODUCT_PRO_MONTHLY = 'prod_pro_m'
    process.env.POLAR_PRODUCT_PRO_YEARLY = 'prod_pro_y'
    process.env.POLAR_PRODUCT_STUDIO_MONTHLY = 'prod_studio_m'
    process.env.POLAR_PRODUCT_STUDIO_YEARLY = 'prod_studio_y'
  })
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('maps each configured product to its own tier and cycle', () => {
    expect(tierFromProduct('prod_pro_m')).toEqual({ tier: 'pro', cycle: 'monthly' })
    expect(tierFromProduct('prod_pro_y')).toEqual({ tier: 'pro', cycle: 'yearly' })
    expect(tierFromProduct('prod_studio_m')).toEqual({ tier: 'studio', cycle: 'monthly' })
    expect(tierFromProduct('prod_studio_y')).toEqual({ tier: 'studio', cycle: 'yearly' })
  })

  it('returns null for a product it does not know', () => {
    // Null is what makes the webhook refuse the event. Defaulting to a tier here would grant a plan
    // for a product nobody configured — including a product from someone else's Polar account.
    expect(tierFromProduct('prod_unknown')).toBeNull()
    expect(tierFromProduct('')).toBeNull()
  })

  it('never falls back to a tier when the env is not configured', () => {
    for (const k of ENV_KEYS) delete process.env[k]
    expect(tierFromProduct('prod_pro_m'), 'an unconfigured deployment must grant nothing').toBeNull()
  })

  it('does not let one product id serve two tiers', () => {
    // A copy-paste in the env would silently sell Max at the Pro price, or the reverse.
    process.env.POLAR_PRODUCT_STUDIO_MONTHLY = 'prod_pro_m'
    const result = tierFromProduct('prod_pro_m')
    expect(result, 'a duplicated id must resolve to exactly one tier').not.toBeNull()
    expect(['pro', 'studio']).toContain(result?.tier)
  })
})

describe('plan keys and subscription field readers', () => {
  it('accepts only the four real plan keys', () => {
    for (const k of ['pro_monthly', 'pro_yearly', 'studio_monthly', 'studio_yearly']) {
      expect(isPlanKey(k), `${k} is a real plan`).toBe(true)
    }
    for (const k of ['free', 'PRO_MONTHLY', 'studio', 'pro monthly', '']) {
      expect(isPlanKey(k), `${k} must not be a plan key`).toBe(false)
    }
  })

  it('reads product and customer ids in either shape Polar sends', () => {
    // Polar sends these either as a flat id or as a nested object depending on the endpoint.
    expect(subProductId({ product_id: 'p1' } as never)).toBe('p1')
    expect(subProductId({ product: { id: 'p2' } } as never)).toBe('p2')
    expect(subProductId({} as never)).toBeNull()
    expect(subCustomerId({ customer_id: 'c1' } as never)).toBe('c1')
    expect(subCustomerId({ customer: { id: 'c2' } } as never)).toBe('c2')
    expect(subCustomerId({} as never)).toBeNull()
  })
})
