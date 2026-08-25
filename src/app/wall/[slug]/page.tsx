import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import type { Photo } from '@/types'
import { resolveAlbum, fetchAuthorizedPhotos } from '@/lib/server/album-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { albumHasTier } from '@/lib/require-tier'
import PhotoWall from '@/components/PhotoWall'

export const runtime = 'nodejs'
export const revalidate = 0

type Props = { params: Promise<{ slug: string }> }

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'

export const metadata: Metadata = { title: 'Live wall — Hushare', robots: { index: false, follow: false } }

// Live photo wall — a full-screen display (projector / TV at the venue) that shows guest photos the
// instant they're uploaded, with a QR code so guests can scan and add their own. Reuses the same
// album-access gating and the same `album:<id>` realtime channel the album page uses.
export default async function WallPage({ params }: Props) {
  const { slug } = await params
  const cookieStore = await cookies()
  const resolved = await resolveAlbum(slug, false, cookieStore)

  if (resolved.kind === 'invalid' || resolved.kind === 'notfound') notFound()

  // The live wall is a Max feature.
  //
  // Checked here rather than only in the toolbar that opens it: the URL is guessable from any album
  // slug, so a UI-only gate is a suggestion. resolveAlbum strips user_id before returning — it must
  // never reach a client — so the owner is looked up separately, which is one indexed read on a page
  // that is already doing several.
  if (resolved.kind === 'album') {
    const admin = createAdminClient()
    const { data: owner } = await admin
      .from('albums').select('user_id').eq('id', resolved.album.id).maybeSingle()
    if (!(await albumHasTier((owner?.user_id as string | null) ?? null, 'studio'))) {
      return (
        <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#160A12', color: '#F3E0BC', textAlign: 'center', padding: 24, fontFamily: 'var(--font-serif)' }}>
          <div>
            <p style={{ fontSize: 24, fontWeight: 700 }}>The live wall is a Max feature</p>
            <p style={{ fontSize: 15, opacity: 0.7, marginTop: 10 }}>The album itself is unaffected — it opens and works as usual.</p>
          </div>
        </main>
      )
    }
  }

  if (resolved.kind !== 'album') {
    // reveal/password-gated — the public wall only makes sense for an open album.
    return (
      <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#160A12', color: '#F3E0BC', textAlign: 'center', padding: 24, fontFamily: 'var(--font-serif)' }}>
        <div>
          <p style={{ fontSize: 24, fontWeight: 700 }}>This album is private</p>
          <p style={{ fontSize: 15, opacity: 0.7, marginTop: 10 }}>The live wall becomes available once the album is open.</p>
        </div>
      </main>
    )
  }

  // The wall only shows a bounded window — fetch just the newest photos (+ the true total for the
  // "N and counting" line) instead of the whole album.
  let initialPhotos: Photo[] = []
  let initialTotal = 0
  try {
    const res = await fetchAuthorizedPhotos(resolved.album.id, cookieStore, { recentLimit: 80 })
    if (res.kind === 'ok') { initialPhotos = res.photos; initialTotal = res.total ?? res.photos.length }
  } catch {
    initialPhotos = []
  }

  const album = resolved.album
  const albumUrl = `${SITE_URL}/${album.custom_slug ?? album.slug}`

  return (
    <PhotoWall albumId={album.id} title={album.title} albumUrl={albumUrl} accentColor={album.accent_color} initialPhotos={initialPhotos} initialTotal={initialTotal} />
  )
}
