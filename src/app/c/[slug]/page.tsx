import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import HamburgerMenu from '@/components/HamburgerMenu'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getUserTierById } from '@/lib/subscriptions'
import { formatDate } from '@/lib/utils'
import { getServerLocale } from '@/i18n/server'
import { getDictionary, interpolate } from '@/i18n/get-dictionary'

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
  // THE GATES. A collection is a PUBLIC page, so everything it shows about a member album has to
  // answer the same access question /{slug} answers — see the filter below.
  password_hash: string | null
  reveal_at: string | null
  retired_at: string | null
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

  const dict = getDictionary(await getServerLocale())

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
          <p className="text-xs uppercase mb-3" style={{ color: '#8B6F4E', letterSpacing: '0.18em', fontWeight: 600 }}>{dict['c.unavailableEyebrow']}</p>
          <h1 className="text-2xl font-bold mb-3" style={{ color: '#630826', fontFamily: 'var(--font-serif)' }}>
            {collection.name}
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: '#5C4A3C' }}>
            {dict['c.unavailableBody']}
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

  // ALBUMS FIRST, then only what each visible one needs.
  //
  // This page used to fetch EVERY PHOTO OF EVERY ALBUM in the collection — on a public URL, with no
  // sign-in — to derive one cover image and two numbers per album. PostgREST stops at 1,000 rows,
  // so past that the counts it printed were silently wrong, and the account page had already fixed
  // this exact defect and written down why. It also pulled up to 1,000 photo rows on every
  // unauthenticated load, against the database transfer allowance the rest of the codebase guards.
  const { data: albums, error: albumsError } = albumIds.length
    ? await admin
        .from('albums')
        .select('id, slug, custom_slug, title, cover_photo_id, created_at, owner_token, password_hash, reveal_at, retired_at')
        .in('id', albumIds)
        .returns<AlbumSummary[]>()
    : { data: [] as AlbumSummary[], error: null }

  if (albumsError) {
    console.error('[c/slug] query failed:', albumsError.message)
    return (
      <main className="min-h-screen flex items-center justify-center px-4" style={{ background: '#FDFAF5' }}>
        <div className="max-w-md w-full rounded-2xl p-8 text-center" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
          <p className="text-xs uppercase mb-3" style={{ color: '#8B6F4E', letterSpacing: '0.18em', fontWeight: 600 }}>{dict['c.serviceError']}</p>
          <h1 className="text-2xl font-bold mb-3" style={{ color: '#630826', fontFamily: 'var(--font-serif)' }}>
            {dict['c.unavailableEyebrow']}
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: '#5C4A3C' }}>
            {dict['c.serviceErrorBody']}
          </p>
        </div>
      </main>
    )
  }

  // A COLLECTION MAY NOT PUBLISH WHAT THE ALBUM ITSELF WITHHOLDS.
  //
  // This page is public — no sign-in, no password — and it was re-implementing the album read with
  // createAdminClient() instead of going through resolveAlbum, so it skipped every gate that file
  // owns. A password-protected wedding put into a collection (the "show my clients my work"
  // feature, so exactly the expected use) published its title, its exact photo count, and a
  // full-resolution URL of one of its photos to anyone holding the collection link, while
  // /{slug} for the same album correctly asked for the password. Two answers to one question.
  //
  // A gated album is dropped from the page entirely rather than shown locked: the collection is a
  // shop window, and a tile that says "this one is private" still leaks that it exists and how
  // many photos are in it.
  const now = Date.now()
  const visibleAlbums = (albums ?? []).filter((a) => (
    !a.retired_at &&
    !a.password_hash &&
    !(a.reveal_at && new Date(a.reveal_at).getTime() > now)
  ))

  // Bounded: a collection is a shop window, not a catalogue. Past this many albums the page would
  // be unreadable anyway, and the cost of building it stops being bounded.
  const MAX_COLLECTION_ALBUMS = 60
  const allVisible = albumIds
    .map((id) => visibleAlbums.find((a) => a.id === id))
    .filter((a): a is AlbumSummary => Boolean(a))
  const shown = allVisible.slice(0, MAX_COLLECTION_ALBUMS)
  // The REAL number of albums in this collection, which is not the number of tiles when the cap
  // bites. The hero printed orderedAlbums.length under the label "Albums", so a photographer with
  // 61 albums showed their client "60 Albums" and nothing said a cap had been applied — a wrong
  // number stated as fact on a public page (rule 20).
  const totalAlbums = allVisible.length

  // Per album: two counts and one cover row. Counts come back from Postgres as counts — never by
  // fetching rows and measuring the array, which is what produced the wrong numbers.
  // NOT hidden, everywhere: on an album with require_approval every guest upload starts hidden, and
  // the earliest one was becoming this page's cover — publishing a photo the owner had not approved
  // and counting it, on a public URL, against a promise the pricing page makes in writing.
  const perAlbum = await Promise.all(shown.map(async (album) => {
    const base = () => admin.from('photos').select('id', { count: 'exact', head: true })
      .eq('album_id', album.id).eq('hidden', false)
    const coverQuery = album.cover_photo_id
      ? admin.from('photos')
          .select('id, album_id, url, poster_url, stream_thumbnail_url, media_type, created_at')
          .eq('id', album.cover_photo_id).eq('hidden', false).maybeSingle<MediaPreview>()
      : Promise.resolve({ data: null })
    const [totalRes, videoRes, pinnedRes] = await Promise.all([
      base(),
      base().eq('media_type', 'video'),
      coverQuery,
    ])
    let cover = (pinnedRes as { data: MediaPreview | null }).data
    if (!cover) {
      // The album's own first photo, preferring an image — one row, ordered, not the whole album.
      const { data } = await admin.from('photos')
        .select('id, album_id, url, poster_url, stream_thumbnail_url, media_type, created_at')
        .eq('album_id', album.id).eq('hidden', false)
        .order('media_type', { ascending: true })   // 'image' sorts before 'video'
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle<MediaPreview>()
      cover = data
    }
    return {
      ...album,
      cover_url: cover
        ? cover.media_type === 'video'
          ? cover.stream_thumbnail_url || cover.poster_url || null
          : cover.url
        : null,
      // A count we could not take is not a count of zero — it is unknown, and printing "0 items"
      // over a full wedding album, on the public page a photographer shows their clients, is
      // exactly the wrong number rule 20 is about. So it falls back to NULL and the tile omits the
      // figure entirely.
      //
      // This comment described that behaviour while the code said `?? 0`, which is the failure the
      // comment warns against: `count` is null on any error, and the error was never read at all.
      media_count: totalRes.error ? null : totalRes.count,
      video_count: videoRes.error ? null : videoRes.count,
    }
  }))

  const orderedAlbums = perAlbum

  // A total built from counts that are partly unknown is not a total. If any album's count could
  // not be read, the hero figure would silently understate the collection — so it is withheld
  // rather than printed wrong (rule 20: "still looking" and "nothing" must not look the same).
  const mediaTotal = orderedAlbums.some((a) => a.media_count === null)
    ? null : orderedAlbums.reduce((sum, a) => sum + (a.media_count ?? 0), 0)
  const videoTotal = orderedAlbums.some((a) => a.video_count === null)
    ? null : orderedAlbums.reduce((sum, a) => sum + (a.video_count ?? 0), 0)
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
          <Link href="/" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>{dict['nav.home']}</Link>
          <Link href="/pricing" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>{dict['nav.pricing']}</Link>
          <Link href="/about" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>{dict['nav.about']}</Link>
          <Link href="/support" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>{dict['nav.support']}</Link>
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
              {dict['c.studioCollection']}
            </p>
            <h1
              className="text-4xl sm:text-5xl font-bold mb-4"
              style={{ fontFamily: 'var(--font-serif)', lineHeight: 1.02 }}
            >
              {collection.name}
            </h1>
            <p className="text-base sm:text-lg leading-relaxed max-w-2xl" style={{ color: '#FBF4E4' }}>
              {collection.description ?? dict['c.descFallback']}
            </p>
          </div>
          <div className="relative z-10 mt-8 grid grid-cols-3 gap-3 max-w-xl">
            {([
              [totalAlbums === 1 ? dict['c.statAlbum'] : dict['c.statAlbums'], totalAlbums],
              [dict['c.statMedia'], mediaTotal],
              [videoTotal === 1 ? dict['c.statVideo'] : dict['c.statVideos'], videoTotal],
            ] as const).filter(([, value]) => value !== null).map(([label, value]) => (
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
              ? `/${album.custom_slug ?? album.slug}#owner=${album.owner_token}`
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
                      {dict['c.noCover']}
                    </div>
                  )}
                  {/* Omitted entirely when the count is unknown — a missing badge says nothing,
                      while "0 items" over a full album states something false. */}
                  {album.media_count !== null && (
                    <span
                      className="absolute right-3 top-3 rounded-full px-2 py-1 text-xs font-semibold"
                      style={{ background: 'rgba(253,250,245,0.92)', color: '#630826' }}
                    >
                      {interpolate(dict[album.media_count === 1 ? 'c.itemOne' : 'c.itemMany'], { n: album.media_count })}
                    </span>
                  )}
                </div>
                <div className="p-4">
                  <h2 className="font-semibold mb-2 truncate" style={{ color: '#630826' }}>
                    {album.title}
                  </h2>
                  <p className="text-xs" style={{ color: '#8B6F4E' }}>
                    {dict['c.created']} {formatDate(album.created_at)}
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
            <p className="font-semibold" style={{ color: '#630826' }}>{dict['c.emptyTitle']}</p>
            <p className="mt-2 text-sm" style={{ color: '#8B6F4E' }}>
              {dict['c.emptyBody']}
            </p>
          </div>
        )}
      </section>
    </main>
  )
}
