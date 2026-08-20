import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import type { Photo } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveAlbum, fetchAuthorizedPhotos } from '@/lib/server/album-access'
import { track } from '@/lib/analytics'
import { getServerLocale } from '@/i18n/server'
import { getDictionary } from '@/i18n/get-dictionary'
import AlbumPageClient from './AlbumPageClient'

export const runtime = 'nodejs'
export const revalidate = 0

type Props = { params: Promise<{ slug: string }> }

type AlbumMeta = {
  id: string
  title: string
  slug: string
  custom_slug: string | null
  cover_photo_id: string | null
  header_image: string | null
  reveal_at: string | null
  password_hash: string | null
}

type PhotoMeta = {
  url: string | null
  thumb_url: string | null
  media_type: string
  poster_url: string | null
  stream_thumbnail_url: string | null
}

// Same charset resolveAlbum enforces before its own .or() — see the note in fetchAlbumMeta.
const SLUG_SAFE = /^[a-zA-Z0-9-]{1,80}$/

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
const BRAND_OG_IMAGE = `${SITE_URL}/logo/logo-1-primary.png`

// URL fragments never reach a server, so an owner opening their #owner= management link is always
// served the GUEST render first: the guest actions bar, or — on a gated album — the password/reveal
// gate. React can only correct that after it has hydrated and re-checked ownership, by which point
// the wrong thing has been on screen for a visible moment ("guest view → management view", and the
// "this album is protected" flash). This runs while the parser is still above that markup, marks
// the document, and lets album.css keep the guest-only chrome from painting at all. AlbumPageClient
// clears the mark as soon as it knows what this visitor actually is, so a stale or wrong token
// still ends up with a normal guest page. Inline is intentional and CSP-safe (script-src keeps
// 'unsafe-inline'; see next.config.ts) — an external file would load too late to be worth anything.
const OWNER_HASH_FLAG_SCRIPT =
  "try{if(new URLSearchParams(location.hash.slice(1)).get('owner')){document.documentElement.dataset.hushOwner='1'}}catch(e){}"

function OwnerHashFlag() {
  return <script dangerouslySetInnerHTML={{ __html: OWNER_HASH_FLAG_SCRIPT }} />
}

function photoOgUrl(photo: PhotoMeta): string | null {
  const candidates = photo.media_type === 'video'
    ? [photo.stream_thumbnail_url, photo.poster_url]
    : [photo.thumb_url, photo.url]
  for (const url of candidates) {
    if (url && url.startsWith('https://')) return url
  }
  return null
}

async function fetchAlbumMeta(slug: string): Promise<AlbumMeta | null> {
  const admin = createAdminClient()
  const cols = 'id, title, slug, custom_slug, cover_photo_id, header_image, reveal_at, password_hash'
  // One query, not two. This asked for the same row twice — once by slug, once by custom_slug —
  // on every album page load, because generateMetadata runs alongside the page body. resolveAlbum
  // has always used the .or() form for exactly this lookup; this just stops the metadata path
  // disagreeing with it.
  //
  // The slug charset guard matters: PostgREST parses .or() as a filter expression, so a value
  // containing , ( ) " or \ could break out of the intended condition. SLUG_SAFE mirrors the guard
  // resolveAlbum applies before its own .or(). A rejected slug simply has no album.
  if (!SLUG_SAFE.test(slug)) return null
  const { data } = await admin
    .from('albums')
    .select(cols)
    .or(`slug.eq.${slug},custom_slug.eq.${slug}`)
    .is('retired_at', null)
    .limit(2)
  const rows = (data ?? []) as AlbumMeta[]
  // Prefer an exact slug match, mirroring resolveAlbum, so the two never resolve to different
  // albums if a custom_slug ever shadowed another album's random slug.
  return rows.find((r) => r.slug === slug) ?? rows[0] ?? null
}

async function fetchCoverUrl(album: AlbumMeta): Promise<string | null> {
  const admin = createAdminClient()
  const cols = 'url, thumb_url, media_type, poster_url, stream_thumbnail_url'

  if (album.cover_photo_id) {
    const { data } = await admin
      .from('photos')
      .select(cols)
      .eq('id', album.cover_photo_id)
      .eq('album_id', album.id)
      .maybeSingle()
    if (data) return photoOgUrl(data as PhotoMeta)
  }

  const { data } = await admin
    .from('photos')
    .select(cols)
    .eq('album_id', album.id)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data ? photoOgUrl(data as PhotoMeta) : null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const [album, dict] = await Promise.all([fetchAlbumMeta(slug), getServerLocale().then(getDictionary)])

  if (!album) {
    return { title: dict['seo.albumFallback'], robots: { index: false, follow: false } }
  }

  const isRevealed = !album.reveal_at || new Date(album.reveal_at) <= new Date()
  // Don't expose cover photo URL in OG tags for locked or password-protected albums —
  // the password check on the page itself would be bypassed by crawlers reading meta tags.
  const isPubliclyViewable = isRevealed && !album.password_hash
  const coverUrl = isPubliclyViewable ? (album.header_image ?? await fetchCoverUrl(album)) : null
  const ogImage = coverUrl ?? BRAND_OG_IMAGE

  return {
    title: album.title,
    description: dict['seo.albumDesc'],
    metadataBase: new URL(SITE_URL),
    alternates: { canonical: `/${album.custom_slug ?? slug}` },
    robots: { index: false, follow: false },
    openGraph: {
      type: 'website',
      title: album.title,
      description: dict['seo.albumDesc'],
      url: `${SITE_URL}/${album.custom_slug ?? slug}`,
      images: [{ url: ogImage, width: 1200, height: 630, alt: album.title }],
    },
    twitter: {
      card: coverUrl ? 'summary_large_image' : 'summary',
      title: album.title,
      images: [ogImage],
    },
  }
}

// Server-render the album so a guest gets the photos in the initial HTML instead of waiting on
// JS → hydrate → two client API round-trips (resolve, then photos). The client still hydrates for
// interactivity (owner upgrade via #owner=, realtime, uploads). The server cannot read the #owner=
// URL fragment, so it resolves as a guest (wantsOwner=false): gated albums render their gate here
// and the owner upgrades client-side exactly as before.
export default async function AlbumPage({ params }: Props) {
  const { slug } = await params
  const cookieStore = await cookies()
  const resolved = await resolveAlbum(slug, false, cookieStore)

  if (resolved.kind === 'invalid' || resolved.kind === 'notfound') notFound()

  // NOTE: canonicalising the URL to the album's custom slug is done in the BROWSER
  // (see AlbumPageClient), NOT with a redirect() here. A server redirect was tried on 2026-08-19 and
  // locked owners out of their own albums: the account page links to /{random-slug}#owner={token}
  // through a Next <Link>, so the navigation is client-side, the router resolves the redirect
  // itself, and it navigates to the bare Location value — dropping the fragment that carries the
  // owner token. The owner landed on the canonical URL as a guest, every single time.
  // Fragments are never sent to a server, so no server-side redirect can preserve one here.

  if (resolved.kind === 'reveal') {
    return (
      <>
        <OwnerHashFlag />
        <AlbumPageClient initialGate={{ type: 'reveal', revealAt: resolved.reveal_at, slug: resolved.slug, title: resolved.title }} />
      </>
    )
  }
  if (resolved.kind === 'password') {
    return (
      <>
        <OwnerHashFlag />
        <AlbumPageClient initialGate={{ type: 'password', slug: resolved.slug, title: resolved.title }} />
      </>
    )
  }

  // Count an album view — one per server-rendered page load. Fire-and-forget (writeDataPoint is
  // synchronous + non-blocking and track() swallows all errors), so it never affects the render.
  // The server can't read the #owner= fragment, so views are recorded as guest — which is what the
  // overwhelming majority are; a rare owner reload counting is acceptable noise for a views metric.
  track({ name: 'album_viewed', albumId: resolved.album.id, source: 'guest' })

  // Open / already-unlocked — fetch photos server-side so they land in the initial HTML.
  let initialPhotos: Photo[] = []
  let initialTotal = 0
  try {
    const photosRes = await fetchAuthorizedPhotos(resolved.album.id, cookieStore)
    if (photosRes.kind === 'ok') {
      initialPhotos = photosRes.photos
      initialTotal = photosRes.total ?? photosRes.photos.length
    }
  } catch {
    // Server-side photo fetch failed — render the shell; the client effect refetches.
    initialPhotos = []
  }

  return (
    <>
      <OwnerHashFlag />
      <AlbumPageClient initialAlbum={resolved.album} initialPhotos={initialPhotos} initialTotal={initialTotal} />
    </>
  )
}
