import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import type { Photo } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveAlbum, fetchAuthorizedPhotos } from '@/lib/server/album-access'
import { getServerLocale } from '@/i18n/server'
import { getDictionary } from '@/i18n/get-dictionary'
import AlbumPageClient from './AlbumPageClient'

export const runtime = 'nodejs'
export const revalidate = 0

type Props = { params: Promise<{ slug: string }> }

type AlbumMeta = {
  id: string
  title: string
  custom_slug: string | null
  cover_photo_id: string | null
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

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
const BRAND_OG_IMAGE = `${SITE_URL}/logo/logo-1-primary.png`

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
  const cols = 'id, title, custom_slug, cover_photo_id, reveal_at, password_hash'
  const [bySlug, byCustom] = await Promise.all([
    admin.from('albums').select(cols).eq('slug', slug).is('retired_at', null).maybeSingle(),
    admin.from('albums').select(cols).eq('custom_slug', slug).is('retired_at', null).maybeSingle(),
  ])
  return (bySlug.data ?? byCustom.data ?? null) as AlbumMeta | null
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
  const coverUrl = isPubliclyViewable ? await fetchCoverUrl(album) : null
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

  if (resolved.kind === 'reveal') {
    return <AlbumPageClient initialGate={{ type: 'reveal', revealAt: resolved.reveal_at, slug: resolved.slug, title: resolved.title }} />
  }
  if (resolved.kind === 'password') {
    return <AlbumPageClient initialGate={{ type: 'password', slug: resolved.slug, title: resolved.title }} />
  }

  // Open / already-unlocked — fetch photos server-side so they land in the initial HTML.
  let initialPhotos: Photo[] = []
  try {
    const photosRes = await fetchAuthorizedPhotos(resolved.album.id, cookieStore)
    if (photosRes.kind === 'ok') initialPhotos = photosRes.photos
  } catch {
    // Server-side photo fetch failed — render the shell; the client effect refetches.
    initialPhotos = []
  }

  return <AlbumPageClient initialAlbum={resolved.album} initialPhotos={initialPhotos} />
}
