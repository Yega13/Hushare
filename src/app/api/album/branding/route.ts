import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { getUserTierById } from '@/lib/subscriptions'
import { queueAlbumSettingsBroadcast } from '@/lib/broadcast'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Remove the Hushare mark from an album's header. Pro and Max only.
//
// albums.hide_branding and its TypeScript field have existed since early on, and nothing ever read
// either of them — the column was listed as a paid feature and did nothing at all. This is the
// half that was missing; AlbumHeader now honours the flag.
//
// Scope is deliberately narrow: it hides OUR name on SOMEONE ELSE'S album. It does not touch the
// album's own logo or title, and it has no effect on the marketing pages, the statement archive, or
// anything legal. Those are ours to sign.
export async function POST(req: Request) {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  const body = await req.json().catch(() => null) as { slug?: unknown; hide_branding?: unknown } | null
  const slug = body?.slug
  const hide = body?.hide_branding
  if (typeof slug !== 'string' || !slug.trim() || typeof hide !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  // The tier checked is the ALBUM OWNER'S, not the caller's.
  //
  // It used to be access.userId — whoever is holding the owner link right now. Owner links are
  // shareable by design, so that asked "is the person clicking this a subscriber?" rather than "is
  // this album on a paid plan?". One Pro account could collect owner links from free users and mint
  // this feature on albums it does not own, without limit — and, until the read-time check added
  // alongside this, permanently. Every other gate in the codebase already asks about
  // album.user_id: upload authorization, Stream, face search and Collections all do.
  // A guest album has no account behind it, so there is nothing to check a plan against.
  const ownerId = access.album.user_id
  if (!ownerId) {
    return NextResponse.json({ error: 'Sign in to change branding' }, { status: 401, headers: NO_STORE })
  }

  // Turning it back ON is always allowed, whatever the plan. Otherwise a lapsed subscription would
  // leave an album permanently unbranded with its owner unable to undo it — punishing someone for
  // cancelling by taking away a choice rather than a feature.
  if (hide) {
    const tier = await getUserTierById(ownerId)
    if (tier === 'free') {
      return NextResponse.json(
        { error: 'Removing Hushare branding requires a Pro or Max plan' },
        { status: 403, headers: NO_STORE },
      )
    }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('albums')
    .update({ hide_branding: hide })
    .eq('id', access.album.id)

  if (error) {
    console.error('[album/branding] update failed:', error.message)
    return NextResponse.json({ error: 'Could not save' }, { status: 500, headers: NO_STORE })
  }

  // Everyone looking at the album sees the change without reloading, same as every other setting.
  await queueAlbumSettingsBroadcast(access.album.id, { hide_branding: hide })

  return NextResponse.json({ ok: true, hide_branding: hide }, { headers: NO_STORE })
}
