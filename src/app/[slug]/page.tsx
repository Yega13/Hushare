import { Suspense } from 'react'
import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import AlbumPageClient from './AlbumPageClient'
import AlbumSkeleton from '@/components/AlbumSkeleton'

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
  const album = await fetchAlbumMeta(slug)

  if (!album) {
    return { title: 'Album', robots: { index: false, follow: false } }
  }

  const isRevealed = !album.reveal_at || new Date(album.reveal_at) <= new Date()
  // Don't expose cover photo URL in OG tags for locked or password-protected albums —
  // the password check on the page itself would be bypassed by crawlers reading meta tags.
  const isPubliclyViewable = isRevealed && !album.password_hash
  const coverUrl = isPubliclyViewable ? await fetchCoverUrl(album) : null
  const ogImage = coverUrl ?? BRAND_OG_IMAGE

  return {
    title: album.title,
    description: 'A shared photo album on Hushare',
    metadataBase: new URL(SITE_URL),
    alternates: { canonical: `/${album.custom_slug ?? slug}` },
    robots: { index: false, follow: false },
    openGraph: {
      type: 'website',
      title: album.title,
      description: 'A shared photo album on Hushare',
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

// AlbumPageClient reads the slug via useParams() — no need to pass it as a prop.
// The Suspense fallback fires while AlbumPageClient's async effects complete on
// initial hydration. Runtime slug resolution is client-side only.
export default function AlbumPage() {
  return (
    <Suspense fallback={<AlbumSkeleton />}>
      <AlbumPageClient />
    </Suspense>
  )
}
