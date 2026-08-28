import { NextResponse } from 'next/server'
import { refuseBelowTier } from '@/lib/require-tier'
import { deleteCollection } from '@/lib/rekognition'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Owner toggle for the AI Face Finder feature. Studio tier only (Rekognition costs money).
export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; enabled?: unknown; consent?: unknown } | null
  const { slug, enabled, consent } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400, headers: NO_STORE })
  }

  // Enabling face search creates biometric data, which European law prohibits unless the people
  // involved have given explicit consent. The Terms assert the owner confirms they hold it, so the
  // product has to actually ask — and refuse if the answer never came. Enforced here rather than
  // only in the dialog, because the dialog is client-side and this endpoint is the real boundary.
  if (enabled === true && consent !== true) {
    return NextResponse.json(
      { error: 'Face Finder needs you to confirm you have consent from the people in these photos.' },
      { status: 400, headers: NO_STORE },
    )
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  // ONLY TURNING IT ON IS GATED. Switching it off must always work, whatever the plan — the same
  // rule api/album/branding and api/album/media-settings already follow. A gate that runs in both
  // directions freezes the setting onto the album of anyone who is not on the plan any more, which
  // costs them the ability to undo a choice rather than costing them a feature.
  // Doubly true here: leaving it on is not a dormant setting, it is biometric indexing that keeps
  // running. Someone must always be able to stop that.
  //
  // THE ALBUM OWNER'S PLAN, NEVER THE CALLER'S. This route asked `getUserTierById(access.userId)`
  // — the person making the request — and it was the last one in the codebase still doing so.
  // branding and custom-url were both corrected with a paragraph explaining why; this one was
  // missed.
  //
  // Owner links are shareable BY DESIGN, so the two are different questions and the answer diverged
  // in both directions at once:
  //   * A Max subscriber holding any stranger's owner link could switch Face Finder on for a FREE
  //     owner's album — writing face_consent_by/face_consent_at naming themselves. A forged
  //     biometric-consent record on someone else's photos, which is the one thing the consent
  //     check above exists to make real.
  //   * A Max customer opening their OWN owner link without a signed-in session was told to sign in
  //     to use a feature they pay for — the 401 that used to sit above this.
  //
  // refuseBelowTier is the shared helper the other nine gated routes already use; it answers
  // "is this ALBUM on the plan", handles the guest-album (no account) case, and names the plan in
  // the error so the owner knows what to buy.
  if (enabled) {
    const refusal = await refuseBelowTier(access.album.user_id, 'studio', 'Face Finder')
    if (refusal) return refusal
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('albums')
    .update(
      enabled
        // Recorded at the moment of the decision, against the person who made it. Switching off
        // clears it so a later re-enable has to be confirmed again rather than riding on a
        // confirmation given for a different set of photographs.
        ? { face_finder_enabled: true, face_consent_at: new Date().toISOString(), face_consent_by: access.userId }
        : { face_finder_enabled: false, face_consent_at: null, face_consent_by: null },
    )
    .eq('id', access.album.id)

  // Switching the feature OFF used to leave every face template in place, still enrolled and still
  // matchable — the switch stopped new photos being read and did nothing about the biometric data
  // already created. Turning it off now means what an owner reasonably assumes it means.
  if (!error && enabled === false) {
    try {
      await deleteCollection(access.album.id)
      // NULL is "never looked at", so re-enabling later re-indexes rather than trusting face ids
      // that AWS no longer holds.
      await admin.from('photos').update({ face_ids: null }).eq('album_id', access.album.id)
    } catch (e) {
      console.error('[album/face-finder] collection delete failed:', e instanceof Error ? e.message : String(e))
    }
  }
  if (error) {
    console.error('[album/face-finder] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update Face Finder' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, face_finder_enabled: enabled }, { headers: NO_STORE })
}
