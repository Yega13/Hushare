import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import HamburgerMenu from '@/components/HamburgerMenu'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasAccountAccess } from '@/lib/access'
import { isAccountAdmin } from '@/lib/auth'
import { getActiveSubscription } from '@/lib/subscriptions'
import { formatDate } from '@/lib/utils'
import CollectionActions from './CollectionActions'
import CreateCollectionButton from './CreateCollectionButton'
import DeleteAlbumButton from './DeleteAlbumButton'
import RenameAlbumButton from './RenameAlbumButton'
import SignOutButton from './SignOutButton'
import SubscriptionPolling from './SubscriptionPolling'

function AccountNav() {
  return (
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
        <Link href="/" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>Home</Link>
        <Link href="/pricing" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>Pricing</Link>
        <Link href="/about" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>About</Link>
        <Link href="/support" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>Support</Link>
      </HamburgerMenu>
    </nav>
  )
}

export const runtime = 'nodejs'

export const metadata: Metadata = {
  title: 'Account',
  description: 'Manage your Hushare subscription.',
  robots: { index: false, follow: false },
}

type Props = {
  searchParams: Promise<{ welcome?: string }>
}

type AccountCollection = {
  id: string
  name: string
  slug: string
  description: string | null
  created_at: string
}

type AccountAlbum = {
  id: string
  slug: string
  custom_slug: string | null
  title: string
  cover_photo_id: string | null
  created_at: string
  // The owner_token is used to build the management link. Safe to include here: this is
  // the signed-in user's OWN album, on their own authenticated dashboard page.
  owner_token: string
}

type AccountMediaRow = {
  id: string
  album_id: string
  media_type: 'image' | 'video'
  url: string
  poster_url: string | null
  stream_thumbnail_url: string | null
  created_at: string
}

export default async function AccountPage({ searchParams }: Props) {
  const { welcome } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?next=/account')
  }

  if (!(await hasAccountAccess(user))) {
    if (welcome === '1') {
      return <SubscriptionPolling email={user.email ?? ''} />
    }
    return (
      <div className="min-h-screen" style={{ background: '#FDFAF5' }}>
        <AccountNav />
        <main className="flex items-center justify-center px-4 py-16">
          <div
            className="max-w-md w-full rounded-2xl p-8 text-center"
            style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', boxShadow: '0 4px 32px rgba(37,79,34,0.10)' }}
          >
            <p className="text-xs uppercase mb-3" style={{ color: '#8B6F4E', letterSpacing: '0.18em', fontWeight: 600 }}>
              403 - Forbidden
            </p>
            <h1 className="text-2xl font-bold mb-3" style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}>
              No account dashboard yet
            </h1>
            <p className="text-sm leading-relaxed mb-5" style={{ color: '#5C4A3C' }}>
              The account dashboard is reserved for Hushare Pro and Max subscribers.
              You&apos;re signed in as <strong className="break-all">{user.email}</strong>,
              but you don&apos;t have an active subscription.
            </p>
            <SignOutButton />
          </div>
        </main>
      </div>
    )
  }

  const subscription = await getActiveSubscription(user.id)
  const isAdmin = isAccountAdmin(user)
  const tierLabel = subscription
    ? subscription.tier === 'pro' ? 'Hushare Pro' : 'Hushare Max'
    : null
  const periodEnd = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : null
  const planName = isAdmin ? 'Hushare Admin' : tierLabel ?? 'Max test access'
  const isStudio = isAdmin || subscription?.tier === 'studio'
  const planFeatures = isAdmin
    ? ['Everything enabled', 'Max Collections', 'Custom album backgrounds', 'Password protection', 'Custom URLs', '200 MB uploads']
    : isStudio
    ? ['Max Collections', 'Custom album backgrounds', 'Password protection', 'Custom URLs', '200 MB uploads']
    : ['Custom album backgrounds', 'Password protection', 'Custom URLs', '200 MB uploads']
  const nextLabel = subscription?.cancel_at_period_end ? 'Access ends' : 'Next renewal'

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (err) {
    console.error('[account] createAdminClient failed:', err)
    return (
      <div className="min-h-screen" style={{ background: '#FDFAF5' }}>
        <AccountNav />
        <main className="flex items-center justify-center px-4 py-16">
          <div className="max-w-md w-full rounded-2xl p-8 text-center" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
            <p className="text-xs uppercase mb-3" style={{ color: '#8B6F4E', letterSpacing: '0.18em', fontWeight: 600 }}>Service error</p>
            <h1 className="text-2xl font-bold mb-3" style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}>Dashboard temporarily unavailable</h1>
            <p className="text-sm leading-relaxed mb-5" style={{ color: '#5C4A3C' }}>
              We&apos;re having trouble connecting to our database. Your albums and data are safe. Please try again in a moment.
            </p>
            <SignOutButton />
          </div>
        </main>
      </div>
    )
  }

  // Fetch collections and albums in parallel — they're independent queries.
  const [collectionsResult, albumsResult] = await Promise.all([
    admin
      .from('collections')
      .select('id, name, slug, description, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .returns<AccountCollection[]>(),
    admin
      .from('albums')
      .select('id, slug, custom_slug, title, cover_photo_id, created_at, owner_token')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .returns<AccountAlbum[]>(),
  ])

  if (collectionsResult.error) {
    console.error('[account] collections query failed:', collectionsResult.error.message)
    return (
      <div className="min-h-screen" style={{ background: '#FDFAF5' }}>
        <AccountNav />
        <main className="flex items-center justify-center px-4 py-16">
          <div className="max-w-md w-full rounded-2xl p-8 text-center" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
            <p className="text-xs uppercase mb-3" style={{ color: '#8B6F4E', letterSpacing: '0.18em', fontWeight: 600 }}>Service error</p>
            <h1 className="text-2xl font-bold mb-3" style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}>Dashboard temporarily unavailable</h1>
            <p className="text-sm leading-relaxed mb-5" style={{ color: '#5C4A3C' }}>
              We&apos;re having trouble loading your data. Your albums and data are safe. Please try again in a moment.
            </p>
            <SignOutButton />
          </div>
        </main>
      </div>
    )
  }

  if (albumsResult.error) {
    console.error('[account] albums query failed:', albumsResult.error.message)
    return (
      <div className="min-h-screen" style={{ background: '#FDFAF5' }}>
        <AccountNav />
        <main className="flex items-center justify-center px-4 py-16">
          <div className="max-w-md w-full rounded-2xl p-8 text-center" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
            <p className="text-xs uppercase mb-3" style={{ color: '#8B6F4E', letterSpacing: '0.18em', fontWeight: 600 }}>Service error</p>
            <h1 className="text-2xl font-bold mb-3" style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}>Dashboard temporarily unavailable</h1>
            <p className="text-sm leading-relaxed mb-5" style={{ color: '#5C4A3C' }}>
              We&apos;re having trouble loading your albums. Your data is safe. Please try again in a moment.
            </p>
            <SignOutButton />
          </div>
        </main>
      </div>
    )
  }

  const collections = collectionsResult.data ?? []
  const accountAlbums = albumsResult.data ?? []

  const collectionIds = collections.map((c) => c.id)
  const accountAlbumIds = accountAlbums.map((a) => a.id)

  // Fetch collection links and media in parallel — both depend on their parent IDs.
  const [collectionLinksResult, accountMediaResult] = await Promise.all([
    collectionIds.length
      ? admin
          .from('collection_albums')
          .select('collection_id, album_id')
          .in('collection_id', collectionIds)
          .returns<Array<{ collection_id: string; album_id: string }>>()
      : Promise.resolve({ data: [] as Array<{ collection_id: string; album_id: string }>, error: null }),
    accountAlbumIds.length
      ? admin
          .from('photos')
          .select('id, album_id, media_type, url, poster_url, stream_thumbnail_url, created_at')
          .in('album_id', accountAlbumIds)
          .order('created_at', { ascending: true })
          .returns<AccountMediaRow[]>()
      : Promise.resolve({ data: [] as AccountMediaRow[], error: null }),
  ])

  const collectionLinks = collectionLinksResult.data ?? []
  const accountMedia = accountMediaResult.data ?? []

  const collectionsWithCounts = collections.map((c) => ({
    ...c,
    album_count: collectionLinks.filter((link) => link.collection_id === c.id).length,
  }))

  const albumsWithMedia = accountAlbums.map((album) => {
    const albumMedia = accountMedia.filter((row) => row.album_id === album.id)
    const pinned = album.cover_photo_id ? albumMedia.find((row) => row.id === album.cover_photo_id) : undefined
    const cover = pinned ?? albumMedia.find((row) => row.media_type === 'image') ?? albumMedia[0]
    return {
      ...album,
      cover_url: cover
        ? (cover.media_type === 'video' ? cover.stream_thumbnail_url || cover.poster_url || null : cover.url)
        : null,
      media_count: albumMedia.length,
    }
  })

  const recentAlbums = albumsWithMedia.slice(0, 6)
  const photoTotal = accountMedia.filter((row) => row.media_type === 'image').length
  const videoTotal = accountMedia.filter((row) => row.media_type === 'video').length
  const mediaTotal = photoTotal + videoTotal
  const customUrlTotal = accountAlbums.filter((album) => album.custom_slug).length

  const dashboardStats = [
    ['Albums', String(accountAlbums.length), 'Claimed to this account'],
    ['Collections', String(collectionsWithCounts.length), `${collectionLinks.length} album link${collectionLinks.length === 1 ? '' : 's'}`],
    ['Media', String(mediaTotal), `${photoTotal} photo${photoTotal === 1 ? '' : 's'} · ${videoTotal} video${videoTotal === 1 ? '' : 's'}`],
    ['Custom URLs', String(customUrlTotal), 'Short branded album links'],
  ]

  return (
    <div className="min-h-screen" style={{ background: '#FDFAF5' }}>
      <AccountNav />
      <main className="hush-account-main px-4 py-10 sm:py-14">
        <div className="hush-container hush-account-container">

          {/* Hero */}
          <section
            className="hush-account-hero hush-fade-up rounded-2xl p-6 sm:p-8 mb-6"
            style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', boxShadow: '0 4px 32px rgba(37,79,34,0.10)' }}
          >
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs mb-3 uppercase tracking-[0.18em]" style={{ color: '#8B6F4E', fontWeight: 600 }}>Account</p>
                <h1 className="text-3xl sm:text-4xl font-bold mb-3" style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}>
                  Your Hushare workspace
                </h1>
                <p className="text-sm break-all" style={{ color: '#5C4A3C' }}>
                  Signed in as <strong>{user.email}</strong>
                </p>
              </div>
              <div className="rounded-xl px-4 py-3" style={{ background: '#F5F0E8', border: '1px solid #DDD5C5' }}>
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: '#8B6F4E' }}>Current access</p>
                <p className="font-semibold" style={{ color: '#254F22' }}>{planName}</p>
              </div>
            </div>
          </section>

          {/* Stats */}
          <section className="hush-account-stats grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
            {dashboardStats.map(([label, value, detail]) => (
              <div
                key={label}
                className="rounded-2xl p-4"
                style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', boxShadow: '0 4px 22px rgba(37,79,34,0.06)' }}
              >
                <p className="text-xs uppercase tracking-wide mb-2" style={{ color: '#8B6F4E' }}>{label}</p>
                <p className="text-2xl font-bold" style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}>{value}</p>
                <p className="mt-1 text-xs leading-snug" style={{ color: '#7C5C3E' }}>{detail}</p>
              </div>
            ))}
          </section>

          {/* Plan + Quick actions */}
          <div className="hush-account-grid grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6">
            <section
              className="hush-account-plan-card hush-hover-lift rounded-2xl p-6"
              style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', boxShadow: '0 4px 32px rgba(37,79,34,0.08)' }}
            >
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <p className="text-xs uppercase tracking-wide mb-1" style={{ color: '#8B6F4E' }}>Plan</p>
                  <h2 className="text-xl font-semibold" style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}>{planName}</h2>
                </div>
                <span className="rounded-full px-3 py-1 text-xs font-semibold capitalize" style={{ background: '#EAF0E8', color: '#254F22' }}>
                  {isAdmin ? 'admin' : subscription?.status ?? 'test'}
                </span>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-5" style={{ color: '#5C4A3C' }}>
                <div className="rounded-xl p-4" style={{ background: '#FDFAF5', border: '1px solid #E8E0D2' }}>
                  <dt className="text-xs uppercase tracking-wide mb-1" style={{ color: '#8B6F4E' }}>Uploads</dt>
                  <dd className="font-semibold" style={{ color: '#254F22' }}>
                    {isAdmin ? 'Everything enabled' : subscription ? 'Up to 200 MB' : 'Studio limits enabled'}
                  </dd>
                </div>
                <div className="rounded-xl p-4" style={{ background: '#FDFAF5', border: '1px solid #E8E0D2' }}>
                  <dt className="text-xs uppercase tracking-wide mb-1" style={{ color: '#8B6F4E' }}>
                    {periodEnd ? nextLabel : 'Billing'}
                  </dt>
                  <dd className="font-semibold" style={{ color: '#254F22' }}>
                    {isAdmin ? 'Admin override' : periodEnd ?? 'No active paid subscription'}
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-2">
                {planFeatures.map((feature) => (
                  <span key={feature} className="rounded-full px-3 py-1 text-xs" style={{ background: '#F5F0E8', color: '#5C4A3C', border: '1px solid #E8E0D2' }}>
                    {feature}
                  </span>
                ))}
              </div>

              {subscription && (
                <form action="/api/portal" method="POST" className="mt-6">
                  <button
                    type="submit"
                    className="w-full font-semibold rounded-xl py-3 text-sm transition hover:opacity-90"
                    style={{ background: '#254F22', color: '#FDFAF5' }}
                  >
                    Manage subscription
                  </button>
                </form>
              )}
            </section>

            <section
              className="hush-account-quick hush-hover-lift rounded-2xl p-6"
              style={{ background: '#FBF4E4', border: '1px solid rgba(196,166,120,0.35)' }}
            >
              <p className="text-xs uppercase tracking-wide mb-2" style={{ color: '#8B6F4E' }}>Quick actions</p>
              <h2 className="text-xl font-semibold mb-3" style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}>Keep building</h2>
              <p className="text-sm leading-relaxed mb-5" style={{ color: '#5C4A3C' }}>
                Create new albums, open Studio pages, or get help without hunting around the site.
              </p>
              <div className="grid gap-2">
                <Link
                  href="/"
                  className="inline-flex w-full items-center justify-center rounded-xl py-3 text-sm font-semibold transition hover:opacity-90"
                  style={{ background: '#254F22', color: '#FDFAF5' }}
                >
                  Create a new album
                </Link>
                <Link
                  href="/support"
                  className="inline-flex w-full items-center justify-center rounded-xl py-3 text-sm font-semibold transition hover:opacity-90"
                  style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#254F22' }}
                >
                  Contact support
                </Link>
              </div>
            </section>
          </div>

          {/* Collections + Albums */}
          <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-2xl p-6" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', boxShadow: '0 4px 32px rgba(37,79,34,0.08)' }}>
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide mb-1" style={{ color: '#8B6F4E' }}>Collections</p>
                  <h2 className="text-xl font-semibold" style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}>Studio pages</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs rounded-full px-3 py-1" style={{ background: '#F5F0E8', color: '#7C5C3E', border: '1px solid #E8E0D2' }}>
                    {collectionsWithCounts.length} total
                  </span>
                  {isStudio && <CreateCollectionButton />}
                </div>
              </div>

              <div className="space-y-3">
                {collectionsWithCounts.slice(0, 5).map((collection) => (
                  <div key={collection.id} className="rounded-xl px-4 py-3" style={{ background: '#FDFAF5', border: '1px solid #E8E0D2' }}>
                    <Link href={`/c/${collection.slug}`} className="flex items-center justify-between gap-4 transition hover:opacity-80">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold" style={{ color: '#254F22' }}>{collection.name}</span>
                        <span className="block truncate text-xs" style={{ color: '#8B6F4E' }}>/c/{collection.slug}</span>
                        {collection.description && (
                          <span
                            className="hush-account-collection-description line-clamp-2 mt-1 block text-xs leading-snug"
                            style={{ color: '#5C4A3C' }}
                          >
                            {collection.description}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs font-semibold" style={{ color: '#7C5C3E' }}>
                        {collection.album_count} album{collection.album_count === 1 ? '' : 's'}
                      </span>
                    </Link>
                    <CollectionActions collection={collection} />
                  </div>
                ))}
                {collectionsWithCounts.length === 0 && (
                  <div className="rounded-xl px-4 py-6 text-center" style={{ background: '#FDFAF5', border: '1px solid #E8E0D2' }}>
                    <p className="font-semibold" style={{ color: '#254F22' }}>No collections yet</p>
                    <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed" style={{ color: '#5C4A3C' }}>
                      Create your first collection above, then add albums to it from each album&apos;s Settings page.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl p-6" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', boxShadow: '0 4px 32px rgba(37,79,34,0.08)' }}>
              <div className="mb-5">
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: '#8B6F4E' }}>Albums</p>
                <h2 className="text-xl font-semibold" style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}>Recently linked</h2>
              </div>
              <div className="space-y-3">
                {recentAlbums.map((album) => (
                  <div key={album.id} className="rounded-xl p-3" style={{ background: '#FDFAF5', border: '1px solid #E8E0D2' }}>
                    <Link href={`/${album.slug}#owner=${album.owner_token}`} className="flex items-center gap-3 transition hover:opacity-80">
                      <span className="relative h-14 w-14 flex-none overflow-hidden rounded-lg" style={{ background: '#E8E0D2' }}>
                        {album.cover_url ? (
                          <Image src={album.cover_url} alt="" fill sizes="56px" className="object-cover" unoptimized />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-[10px] font-semibold" style={{ color: '#8B6F4E' }}>
                            Empty
                          </span>
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold" style={{ color: '#254F22' }}>{album.title}</span>
                        <span className="block text-xs" style={{ color: '#8B6F4E' }}>
                          {album.media_count} item{album.media_count === 1 ? '' : 's'} · Created {formatDate(album.created_at)}
                        </span>
                      </span>
                    </Link>
                    <RenameAlbumButton albumId={album.id} title={album.title} />
                    <DeleteAlbumButton albumId={album.id} />
                  </div>
                ))}
                {recentAlbums.length === 0 && (
                  <div className="rounded-xl px-4 py-6 text-center" style={{ background: '#FDFAF5', border: '1px solid #E8E0D2' }}>
                    <p className="font-semibold" style={{ color: '#254F22' }}>No albums yet</p>
                    <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed" style={{ color: '#5C4A3C' }}>
                      Albums you create while signed in appear here automatically.
                    </p>
                    <Link
                      href="/"
                      className="mt-4 inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition hover:opacity-90"
                      style={{ background: '#254F22', color: '#FDFAF5' }}
                    >
                      Start one now
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Tips */}
          <section className="hush-account-tips grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 mb-6">
            {[
              ['Customize albums', 'Change album colors and stock backgrounds from each owner toolbar.'],
              ['Protect important links', 'Use passwords and custom URLs on Pro and Studio albums.'],
              [
                isStudio ? 'Build Collections' : 'Upgrade for Collections',
                isStudio
                  ? 'Create public /c/... pages that group related albums.'
                  : 'Collections are available on Max.',
              ],
            ].map(([title, copy]) => (
              <div key={title} className="hush-hover-lift rounded-2xl p-5" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
                <h3 className="font-semibold mb-2" style={{ color: '#254F22' }}>{title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: '#5C4A3C' }}>{copy}</p>
              </div>
            ))}
          </section>

          <div className="max-w-sm">
            <SignOutButton />
          </div>
        </div>
      </main>
    </div>
  )
}
