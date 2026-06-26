import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCheckout, tierFromProduct } from '@/lib/polar'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  const rl = await checkRateLimit(clientIpKey(req, 'checkout'), 60, 10, { failOpen: true })
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: NO_STORE })
  }

  let productId: string | null = null
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const body = (await req.json()) as { productId?: string }
      productId = body.productId ?? null
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: NO_STORE })
    }
  } else {
    const form = await req.formData()
    const value = form.get('productId')
    productId = typeof value === 'string' ? value : null
  }

  if (!productId) {
    return NextResponse.json({ error: 'Missing productId' }, { status: 400, headers: NO_STORE })
  }

  const tierMatch = tierFromProduct(productId)
  if (!tierMatch) {
    return NextResponse.json({ error: 'Unknown product' }, { status: 400, headers: NO_STORE })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || !user.email) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('next', `/pricing?product=${encodeURIComponent(productId)}`)
    return NextResponse.redirect(loginUrl, { status: 303, headers: NO_STORE })
  }

  const successUrl = new URL('/account?welcome=1', req.url).toString()

  const discountId =
    productId === process.env.POLAR_PRODUCT_PRO_MONTHLY
      ? process.env.POLAR_DISCOUNT_PRO_FIRST_MONTH
      : productId === process.env.POLAR_PRODUCT_STUDIO_MONTHLY
        ? process.env.POLAR_DISCOUNT_STUDIO_FIRST_MONTH
        : undefined

  let checkout
  try {
    checkout = await createCheckout({
      productId,
      successUrl,
      customerEmail: user.email,
      metadata: { userId: user.id, tier: tierMatch.tier, cycle: tierMatch.cycle },
      discountId,
    })
  } catch (err) {
    console.error(
      '[checkout] Polar createCheckout failed:', err instanceof Error ? err.message : String(err),
      '| productId:', productId,
      '| discountId:', discountId ?? 'none',
    )
    return NextResponse.json(
      { error: 'Could not start checkout. Please try again.' },
      { status: 502, headers: NO_STORE },
    )
  }

  return NextResponse.redirect(checkout.url, { status: 303, headers: NO_STORE })
}
