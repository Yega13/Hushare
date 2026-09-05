import { NextResponse } from 'next/server'
import { refuseAccess } from '@/lib/server/respond'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { claimStatus, claimSucceeded } from '@/lib/album-claim'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// The longest slug either column can hold is bounded by schema.sql; anything longer cannot match
// and should not be carried into a database filter.
const MAX_SLUG = 80

// ATTACH AN ALBUM MADE WITHOUT AN ACCOUNT TO THE ACCOUNT ITS OWNER NOW HAS.
//
// An album created while signed out has no owner row — it belongs to whoever holds the owner link.
// It is attached to an account automatically, inside verifyOwnerViaCookie, but only when a
// signed-in owner touches an owner-only route, and when that is DECLINED the only trace was a line
// in a server log. So an owner at their plan cap saw an album that simply never appeared in their
// profile, with nothing on screen to explain it.
//
// THIS ROUTE WRITES NOTHING. The verify call performs the claim as its documented side effect, the
// same way every other owner route does, and returns what it did. This route exists to TRIGGER
// that path deliberately and to give the person an honest answer about the result — including
// "your plan is full", which no surface had ever said out loud.
//
// It must never re-derive that answer. An earlier draft ran its own tier lookup and its own count
// to decide what to report; when the second count errored it read as zero and the route cheerfully
// reported "added to your account" for an album that was still anonymous. One fact, one place.
export async function POST(req: Request) {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  let body: { slug?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }
  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  if (!slug || slug.length > MAX_SLUG) {
    return NextResponse.json({ error: 'Missing album' }, { status: 400, headers: NO_STORE })
  }

  // Proof of ownership, and the claim itself. Both live behind this one call.
  const access = await verifyOwnerViaCookieWithRateLimit(req, slug)
  if (!access.ok) {
    return refuseAccess(access)
  }

  const outcome = access.claim
  if (claimSucceeded(outcome)) {
    console.info(`[album/claim] album ${access.album.id} is on account ${access.userId} (${outcome})`)
  }

  return NextResponse.json(
    { ok: claimSucceeded(outcome), reason: outcome, cap: outcome === 'at_cap' ? access.claimCap : undefined },
    { status: claimStatus(outcome), headers: NO_STORE },
  )
}
