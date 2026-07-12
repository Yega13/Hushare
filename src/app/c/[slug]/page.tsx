import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import HamburgerMenu from '@/components/HamburgerMenu'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getUserTierById } from '@/lib/subscriptions'
import { formatDate } from '@/lib/utils'

export const runtime = 'nodejs'

type Props = {
  params: Promise<{ slug: string }>
}

type Collection = {
  id: string
  user_id: string
  name: string
  description: string | null
  slug: string
  created_at: string
}

type AlbumSummary = {
  id: string
  slug: string
  custom_slug: string | null
  title: string
  cover_photo_id: string | null
  created_at: string
  owner_token: string
}

type MediaPreview = {
  id: string
  album_id: string
  url: string
  poster_url: string | null
  stream_thumbnail_url: string | null
  media_type: 'image' | 'video'
  created_at: string
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const admin = createAdminClient()
  const { data: collection } = await admin
    .from('collections')
    .select('name, description')
    .eq('slug', slug)
    .maybeSingle<{ name: string; description: string | null }>()

  if (!collection) return { title: 'Collection not found', robots: { index: false, follow: false } }
  return {
    title: collection.name,
    description: collection.description ?? `A curated set of shared Hushare albums.`,
    robots: { index: false, follow: false },
  }
}

export default async function CollectionPage({ params }: Props) {
  const { slug } = await params
  const admin = createAdminClient()

  const { data: collection } = await admin
    .from('collections')
    .select('id, user_id, name, description, slug, created_at')
    .eq('slug', slug)
    .maybeSingle<Collection>()

  if (!collection) notFound()

  // Is the current viewer the owner of this collection? Collections are shareable PUBLIC pages,
  // so album links must stay plain guest links for everyone else — but when the owner browses
  // their own collection, the album links need the #owner= management token or they'd land on
  // the guest view of their own album (the reported "some albums guest, some owner" bug — it
  // depended on whether you reached the album directly from account vs. through a collection).
  // getUser() reads the auth cookie (server-validated), so a guest never gets a token in the HTML.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const isCollectionOwner = !!user && user.id === collection.user_id

  // Collections are a Studio feature — gate the public page to Studio owners.
  const tier = await getUserTierById(collection.user_id)
  if (tier !== 'studio') {
    // The collection exists in the DB but the owner's Studio access has lapsed.
    // Return a proper "temporarily unavailable" page rather than 404 so that:
    // 1. Search engines don't deindex a URL that may come back (e.g. after renewal)
    // 2. The owner's clients understand the page exists but is temporarily inaccessible
    return (
      <main className="min-h-screen flex items-center justify-center px-4" style={{ background: '#FDFAF5' }}>
        <div className="max-w-md w-full rounded-2xl p-8 text-center" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
          <p className="text-xs uppercase mb-3" style={{ color: '#8B6F4E', letterSpacing: '0.18em', fontWeight: 600 }}>Temporarily unavailable</p>
          <h1 className="text-2xl font-bold mb-3" style={{ color: '#630826', fontFamily: 'var(--font-serif)' }}>
            {collection.name}
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: '#5C4A3C' }}>
            This collection is temporarily unavailable. Please check back later.
          </p>
        </div>
      </main>
    )
  }

  const { data: rows } = await admin
    .from('collection_albums')
    .select('album_id, sort_order')
    .eq('collection_id', collection.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  const albumIds = (rows ?? []).map((row) => row.album_id as string)

  // Fetch albums and media in parallel — both only depend on albumIds.
  const [albumsResult, mediaResult] = await Promise.all([
    albumIds.length
      ? admin
          .from('albums')
          .select('id, slug, custom_slug, title, cover_photo_id, created_at, owner_token')
          .in('id', albumIds)
          .returns<AlbumSummary[]>()
      : Promise.resolve({ data: [] as AlbumSummary[], error: null }),
    albumIds.length
      ? admin
          .from('photos')
          .select('id, album_id, url, poster_url, stream_thumbnail_url, media_type, created_at')
          .in('album_id', albumIds)
          .order('created_at', { ascending: true })
          .returns<MediaPreview[]>()
      : Promise.resolve({ data: [] as MediaPreview[], error: null }),
  ])

  if (albumsResult.error || mediaResult.error) {
    console.error('[c/slug] query failed:', (albumsResult.error ?? mediaResult.error)?.message)
    return (
      <main className="min-h-screen flex items-center justify-center px-4" style={{ background: '#FDFAF5' }}>
        <div className="max-w-md w-full rounded-2xl p-8 text-center" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
          <p className="text-xs uppercase mb-3" style={{ color: '#8B6F4E', letterSpacing: '0.18em', fontWeight: 600 }}>Service error</p>
          <h1 className="text-2xl font-bold mb-3" style={{ color: '#630826', fontFamily: 'var(--font-serif)' }}>
            Temporarily unavailable
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: '#5C4A3C' }}>
            We&apos;re having trouble loading this collection. Please try again in a moment.
          </p>
        </div>
      </main>
    )
  }

  const albums = albumsResult.data
  const mediaRows = mediaResult.data

  const orderedAlbums = albumIds
    .map((id) => {
      const album = (albums ?? []).find((a) => a.id === id)
      if (!album) return null
      const albumMedia = (mediaRows ?? []).filter((row) => row.album_id === id)
      const pinned = album.cover_photo_id
        ? albumMedia.find((row) => row.id === album.cover_photo_id)
        : undefined
      const cover = pinned ?? albumMedia.find((row) => row.media_type === 'image') ?? albumMedia[0]
      return {
        ...album,
        cover_url: cover
          ? cover.media_type === 'video'
            ? cover.stream_thumbnail_url || cover.poster_url || null
            : cover.url
          : null,
        media_count: albumMedia.length,
        video_count: albumMedia.filter((row) => row.media_type === 'video').length,
      }
    })
    .filter(
      (
        a,
      ): a is AlbumSummary & { cover_url: string | null; media_count: number; video_count: number } =>
        Boolean(a),
    )

  const mediaTotal = orderedAlbums.reduce((sum, a) => sum + a.media_count, 0)
  const videoTotal = orderedAlbums.reduce((sum, a) => sum + a.video_count, 0)
  const heroCover = orderedAlbums.find((a) => a.cover_url)?.cover_url

  return (
    <main className="min-h-screen" style={{ background: '#FDFAF5', fontFamily: 'var(--font-sans)' }}>
      <nav
        className="hush-nav sticky top-0 z-50 flex items-center justify-between"
        style={{
          background: 'rgba(253, 250, 245, 0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(221, 213, 197, 0.5)',
        }}
      >
        <Link href="/" className="flex items-center transition hover:opacity-70" aria-label="Hushare home">
          <Image
            src="/logo/logo-dark-transparent.png"
            alt="Hushare"
            width={618}
            height={146}
            className="hush-logo"
            style={{ width: 'auto' }}
          />
        </Link>
        <HamburgerMenu>
          <Link href="/" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>Home</Link>
          <Link href="/pricing" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>Pricing</Link>
          <Link href="/about" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>About</Link>
          <Link href="/support" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>Support</Link>
        </HamburgerMenu>
      </nav>

      <section className="hush-container py-8 sm:py-12">
        {/* Hero banner */}
        <div
          className="relative overflow-hidden rounded-2xl px-5 py-10 sm:px-8 sm:py-14"
          style={{ background: '#630826', color: '#FDFAF5', boxShadow: '0 18px 56px rgba(99,8,38,0.16)' }}
        >
          {heroCover && (
            <Image
              src={heroCover}
              alt=""
              fill
              sizes="100vw"
              className="object-cover opacity-25"
              unoptimized
              priority
            />
          )}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(105deg, rgba(99,8,38,0.94), rgba(99,8,38,0.78), rgba(124,74,45,0.35))',
            }}
          />
          <div className="relative z-10 max-w-3xl">
            <p
              className="text-xs uppercase mb-3"
              style={{ color: '#F3E0BC', letterSpacing: '0.18em', fontWeight: 600 }}
            >
              Studio Collection
            </p>
            <h1
              className="text-4xl sm:text-5xl font-bold mb-4"
              style={{ fontFamily: 'var(--font-serif)', lineHeight: 1.02 }}
            >
              {collection.name}
            </h1>
            <p className="text-base sm:text-lg leading-relaxed max-w-2xl" style={{ color: '#FBF4E4' }}>
              {collection.description ?? 'A curated set of shared Hushare albums.'}
            </p>
          </div>
          <div className="relative z-10 mt-8 grid grid-cols-3 gap-3 max-w-xl">
            {([
              ['Albums', orderedAlbums.length],
              ['Media', mediaTotal],
              ['Videos', videoTotal],
            ] as const).map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl px-3 py-3 text-center"
                style={{
                  background: 'rgba(253,250,245,0.12)',
                  border: '1px solid rgba(253,250,245,0.22)',
                }}
              >
                <p className="text-2xl font-bold" style={{ fontFamily: 'var(--font-serif)' }}>{value}</p>
                <p className="text-[11px] uppercase tracking-wide" style={{ color: '#F3E0BC' }}>{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Album grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
          {orderedAlbums.map((album) => {
            // Owner → management link (base slug + #owner= token, matching the account page).
            // Guest → plain public link (never carries the token).
            const href = isCollectionOwner
              ? `/${album.slug}#owner=${album.owner_token}`
              : `/${album.custom_slug ?? album.slug}`
            return (
              <Link
                key={album.id}
                href={href}
                className="hush-hover-lift overflow-hidden rounded-xl transition hover:opacity-95"
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #DDD5C5',
                  boxShadow: '0 4px 20px rgba(99,8,38,0.06)',
                }}
              >
                <div className="relative aspect-[4/3]" style={{ background: '#EDE7DB' }}>
                  {album.cover_url ? (
                    <Image
                      src={album.cover_url}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 30vw, (min-width: 640px) 48vw, 100vw"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div
                      className="flex h-full items-center justify-center text-sm"
                      style={{ color: '#8B6F4E' }}
                    >
                      No cover yet
                    </div>
                  )}
                  <span
                    className="absolute right-3 top-3 rounded-full px-2 py-1 text-xs font-semibold"
                    style={{ background: 'rgba(253,250,245,0.92)', color: '#630826' }}
                  >
                    {album.media_count} item{album.media_count === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="p-4">
                  <h2 className="font-semibold mb-2 truncate" style={{ color: '#630826' }}>
                    {album.title}
                  </h2>
                  <p className="text-xs" style={{ color: '#8B6F4E' }}>
                    Created {formatDate(album.created_at)}
                  </p>
                </div>
              </Link>
            )
          })}
        </div>

        {orderedAlbums.length === 0 && (
          <div
            className="mt-8 rounded-2xl px-5 py-8 text-center"
            style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}
          >
            <p className="font-semibold" style={{ color: '#630826' }}>No albums here yet</p>
            <p className="mt-2 text-sm" style={{ color: '#8B6F4E' }}>
              The owner has not added any albums to this collection.
            </p>
          </div>
        )}
      </section>
    </main>
  )
}
