import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAccountAdmin } from '@/lib/auth'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// WHY POLAR SAYS NO, ANSWERED FROM EVIDENCE INSTEAD OF FROM GUESSES.
//
// Polar rejects a bad token with 401 and this body:
//
//     "The access token provided is expired, revoked, malformed, or invalid for other reasons."
//
// Four causes, and it never says which. That sentence has now cost two wrong fixes: a scope was
// added to an existing token (scopes are stamped in at creation, so nothing changed), and then the
// secret was trimmed on the theory of a trailing newline (correct bug, not this one). Both were
// hypotheses dressed up as diagnoses.
//
// This route replaces the guessing. It reports the SHAPE of the secret the worker is actually
// holding and what Polar answers to one harmless read, so the next step is chosen from facts.
//
// IT NEVER RETURNS THE SECRET. Length, the first six characters, and whether it had surrounding
// whitespace — enough to tell a truncated paste from a webhook secret from a genuinely revoked
// token, and not enough to use. Admin-only, and a 404 to everyone else.
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!isAccountAdmin(user)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  }

  const raw = process.env.POLAR_API_KEY
  if (!raw) {
    return NextResponse.json(
      { secret: 'MISSING', hint: 'POLAR_API_KEY is not set on this worker at all.' },
      { headers: NO_STORE },
    )
  }

  const key = raw.trim()
  const sandbox = process.env.POLAR_SANDBOX === 'true'
  const base = sandbox ? 'https://sandbox-api.polar.sh' : 'https://api.polar.sh'

  // The cheapest authenticated read there is. Products are needed by the pricing checks anyway, so
  // this asks for nothing the app does not already ask for.
  let status: number | string = 'not attempted'
  let body = ''
  try {
    const res = await fetch(`${base}/v1/products/?limit=1`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    status = res.status
    body = (await res.text()).slice(0, 300)
  } catch (e) {
    status = 'network error'
    body = e instanceof Error ? e.message : String(e)
  }

  // Turn the four-way ambiguity into one sentence, based only on what was observed.
  let reading: string
  if (status === 200) {
    reading = 'The token WORKS for products. If orders still fail, it is the orders:read scope specifically.'
  } else if (status === 401 && !key.startsWith('polar_')) {
    reading = 'This does not look like a Polar token at all — likely the webhook secret or another value was pasted.'
  } else if (status === 401 && key.length < 40) {
    reading = 'This looks TRUNCATED. Polar shows the token once; copying part of it gives exactly this 401.'
  } else if (status === 401) {
    reading = 'Well-formed and still refused: the token was revoked, has expired, or belongs to a different organization. Create a new one and set it again.'
  } else if (status === 403) {
    reading = 'The token is VALID but lacks a scope. Products need products:read; the nightly package repair needs orders:read.'
  } else {
    reading = 'Polar did not answer the way either a good or a bad token does — read the body below.'
  }

  return NextResponse.json({
    secret: {
      length: key.length,
      startsWith: key.slice(0, 6),
      looksLikePolarToken: key.startsWith('polar_'),
      hadSurroundingWhitespace: key !== raw,
    },
    calling: base,
    sandboxMode: sandbox,
    polarStatus: status,
    polarBody: body,
    reading,
  }, { headers: NO_STORE })
}
