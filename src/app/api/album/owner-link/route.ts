import { NextResponse } from 'next/server'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Returns the album's owner_token to a VERIFIED owner so the client can build the
// shareable "owner management link". This is the one place owner_token is intentionally
// returned in a body — gated hard by verifyOwnerViaCookie, which authorizes only the
// owner cookie OR a logged-in account owner (album.user_id match). A guest can never
// reach past that gate. Same-site only (forbidCrossSiteRequest) and never cached.
//
// Account owners have no #owner= link and never learned the token client-side, so this
// is how their Share menu obtains it to display the management link.
export async function GET(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  const slug = (new URL(req.url).searchParams.get('slug') ?? '').trim()
  if (!slug) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, slug)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  return NextResponse.json({ owner_token: access.album.owner_token }, { headers: NO_STORE })
}
