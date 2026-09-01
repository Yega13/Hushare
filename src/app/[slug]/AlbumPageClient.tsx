'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useParams, notFound } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { shouldHoldForOwnerCheck } from '@/lib/owner-view'
import { applyPhotoWindow, mergePreservingExtras, shouldApplyRefresh } from '@/lib/photo-window'
import { createSettingsSync, shouldCommitSettings } from '@/lib/settings-sync'
import { fallbackPollDelay } from '@/lib/realtime-fallback'
import { albumChanged, deltaRowsNeeded, type AlbumFreshness } from '@/lib/album-freshness'
import type { Album, Photo, Tier } from '@/types'
import AlbumSkeleton from '@/components/AlbumSkeleton'
import PasswordGate from '@/components/PasswordGate'
import RevealCountdown from '@/components/RevealCountdown'
import RevealCurtain from '@/components/RevealCurtain'
import PhotoGrid from '@/components/PhotoGrid'
import AlbumHeader from '@/components/AlbumHeader'
import GuestActionsBar from '@/components/GuestActionsBar'
import { rememberOwnedAlbum, getMyAlbums } from '@/lib/my-albums'
import SignInPrompt from '@/components/SignInPrompt'
import PendingReview from '@/components/PendingReview'
import RenewPackagePrompt from '@/components/RenewPackagePrompt'
import PackageThanksBanner from '@/components/PackageThanksBanner'
import BibSearchBar, { bibMatches } from '@/components/BibSearchBar'
import { fontStack, isImageBackground, getBackgroundImageUrl, getBackgroundColorStyle, resolveHeaderImageUrl, resolveHeaderVideo } from '@/lib/album-design'
import { retryImport } from '@/lib/lazy-retry'

// Code-split out of the shared album bundle: OwnerToolbar (+ tus/JSZip-adjacent upload code),
// FaceFinder, and AlbumDesigner are only ever needed by the owner or by guests who opt in, never
// by an ordinary guest viewing photos. UploadZone pulls in tus-js-client, which guests on
// view-only albums never need either. This keeps the JS a first-time guest downloads to just what
// renders — a guest should never pay for the owner's design-panel bundle.
// ssr:false keeps this component's whole module graph OUT of the server bundle. It pulls in
// heic2any (~1.3MB) to decode iPhone HEIC files, which is browser-only code that can never run
// server-side — yet server-rendering the component still bundled it into the Worker, and that
// alone pushed the Worker past Cloudflare's size limit and blocked deploys. Uploading is a
// click-driven, browser-only flow with nothing to pre-render, so there is nothing to lose here.
const UploadZone = dynamic(retryImport(() => import('@/components/UploadZone')), { ssr: false })
const OwnerToolbar = dynamic(retryImport(() => import('@/components/OwnerToolbar')))
const FaceFinder = dynamic(retryImport(() => import('@/components/FaceFinder')))
const AlbumDesigner = dynamic(retryImport(() => import('@/components/AlbumDesigner')))

const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space').replace(/\/+$/, '')

// ─── Component ────────────────────────────────────────────────────────────────

type InitialGate =
  | { type: 'password'; slug: string; title: string }
  | { type: 'reveal'; revealAt: string; slug: string; title: string }

type Props = {
  // Server-rendered initial state (src/app/[slug]/page.tsx). When present, the page paints
  // immediately from these instead of showing a skeleton and doing the client resolve+photos fetch.
  initialAlbum?: Album | null
  initialPhotos?: Photo[]
  initialTotal?: number
  initialGate?: InitialGate
}

// Full album view server-renders the first window; a BIG album (> first window) loads its tail on
// demand. Small albums (every album today) load fully in the first window — pagination never engages.
// A single frozen empty list. An inline [] is a new array every render, which would defeat the
// memos below the moment an album has nothing awaiting review — i.e. almost always.
const EMPTY_PHOTOS: Photo[] = []

const ALBUM_FIRST_WINDOW = 500 // must match ALBUM_PAGE_SIZE in lib/server/album-access.ts
// Above this many new photos a delta stops being cheaper than just taking the window again, and
// the merge has more chances to be wrong. 100 rows is roughly 85 KB against the window's 424 KB.
const ALBUM_DELTA_MAX = 100
// How long to collapse a burst of realtime pings into one refetch. See the note at the debounce.
const REFETCH_DEBOUNCE_MS = 2500
const LOAD_MORE_PAGE = 500
// Most photos one bib number can sensibly return. A runner is in tens of photos; a junk OCR reading
// off a banner ("2026") can hit thousands, and that is the request this bounds.
const BIB_RESULT_LIMIT = 300

// How long after one of THIS tab's own album edits a settings-broadcast refetch is treated as an
// echo of that edit rather than news from somewhere else. Every owner mutation broadcasts, and the
// owner's own tab is subscribed to that broadcast — so each edit made the owner refetch and
// blind-merge the whole album row over their own optimistic state. Two edits inside one round trip
// (or one debounced slider firing twice) and the first refetch lands AFTER the second edit,
// overwriting it with the pre-edit row, until the second broadcast puts it back. That is the
// "control moves to the new value, snaps back to the old one, then settles" glitch, and it is why
// it only showed up on a phone: the race window is one network round trip wide.
const SELF_EDIT_QUIET_MS = 2500

export default function AlbumPageClient({ initialAlbum = null, initialPhotos, initialTotal, initialGate }: Props = {}) {
  const { slug } = useParams<{ slug: string }>()
  const [supabase] = useState(() => createClient())

  // Album data — seeded from the server render when available.
  const [album, setAlbum] = useState<Album | null>(initialAlbum)
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos ?? [])
  // Total authorized photos in the album (may exceed what's loaded on a big album). `hasMore` drives
  // the "Load more" control. Refs mirror the latest values so loadMore stays a stable callback.
  const [total, setTotal] = useState<number>(initialTotal ?? initialPhotos?.length ?? 0)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadingMoreRef = useRef(false)
  const photosLenRef = useRef(photos.length); photosLenRef.current = photos.length
  const totalRef = useRef(total); totalRef.current = total
  const albumIdRef = useRef<string | null>(initialAlbum?.id ?? null); albumIdRef.current = album?.id ?? null
  const albumOrderRef = useRef<string | undefined>(initialAlbum?.photo_order); albumOrderRef.current = album?.photo_order

  // Loading gates — not loading when the server already provided album or gate state.
  const [loading, setLoading] = useState(!initialAlbum && !initialGate)
  const [isNotFound, setIsNotFound] = useState(false)
  const [networkError, setNetworkError] = useState(false)
  const [passwordGate, setPasswordGate] = useState<{
    slug: string; title: string
  } | null>(initialGate?.type === 'password' ? { slug: initialGate.slug, title: initialGate.title } : null)
  const [revealGate, setRevealGate] = useState<{
    revealAt: string; slug: string; title: string
  } | null>(initialGate?.type === 'reveal' ? { revealAt: initialGate.revealAt, slug: initialGate.slug, title: initialGate.title } : null)
  // Raised the instant a scheduled album unlocks, and lowered by the curtain itself once its panels
  // are fully off-screen. Kept HERE rather than inside RevealCountdown because that component
  // unmounts the moment the gate clears — the curtain has to outlive it to cover the swap.
  const [curtain, setCurtain] = useState(false)


  // Owner
  const [ownerTokenReady, setOwnerTokenReady] = useState(false)
  const [ownerToken, setOwnerToken] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  // STATE mirror of ownerTokenFromUrlRef, used to compute the rendered `effectiveIsOwner`. A ref
  // does not trigger a re-render when it flips and reading a ref during render is fragile — using
  // state here guarantees the guest↔owner bar re-renders reliably. The ref is kept for synchronous
  // reads inside async callbacks (resolve/owner-login/realtime); both are set together in Effect 1.
  const [ownerTokenInUrl, setOwnerTokenInUrl] = useState(false)
  const [showFaceFinder, setShowFaceFinder] = useState(false)
  const [bibQuery, setBibQuery] = useState('')
  // Owner "save your album" prompt — a one-time MODAL shown to a signed-OUT owner a few seconds
  // after they've finished adding photos, offering the one-tap Google save.
  const [ownerSavePromptOpen, setOwnerSavePromptOpen] = useState(false)
  // ?renew=1 comes from the renewal email. Read once; navigation within the page keeps it.
  const [renewRequested] = useState(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('renew') === '1')
  // ?package=thanks is Polar's redirect after a package is paid for. Also read once — this page
  // load IS the return from checkout, and the banner owns the wait from here.
  const [thanksRequested] = useState(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('package') === 'thanks')
  const ownerPromptShownRef = useRef(false)
  // Album Designer (full-screen customization editor). The ref lets Effect 4 skip the owner's OWN
  // settings-refetch while designing, so rapid edits don't flicker (the reported glitch).
  const [designerOpen, setDesignerOpen] = useState(false)
  const designerOpenRef = useRef(false)
  useEffect(() => { designerOpenRef.current = designerOpen }, [designerOpen])
  // When this tab last applied an album edit of its own (see handleAlbumUpdated). Effect 4 uses it
  // to tell its own echo apart from a real external change — see SELF_EDIT_QUIET_MS.
  const lastLocalAlbumPatchRef = useRef(0)
  // A settings refetch that fell due while the Album Designer was open. Running it then would
  // overwrite the Designer's live optimistic preview; simply dropping it would leave the album
  // stale indefinitely, because the timer that scheduled it is one-shot and nothing re-arms it —
  // if the owner's own edit was the last broadcast, no later one is coming. So we record the debt
  // and pay it when the Designer closes.
  const settingsRefetchOwedRef = useRef(false)
  const refetchSettingsRef = useRef<(() => void) | null>(null)
  // When the prompt is triggered by a click on an in-app link that LEAVES the album (e.g. the
  // Hushare logo → home), we hold that destination here so dismissing the prompt still takes them
  // where they were going. Null when the prompt was triggered by back/tab-hidden/mouse-exit.
  const pendingLeaveHrefRef = useRef<string | null>(null)

  // Display state — consumed by Phase 7–9 components
  // The ALBUM'S plan, derived from the album rather than stored beside it.
  //
  // This was /api/me/tier — the plan of whoever is looking — and that is a different question.
  // Owner links are shareable, and the server gates on album.user_id, so the two could disagree
  // outright: an admin opening a free owner's album saw no PRO marks while every one of those
  // features was refused, and an admin could never see the marks at all on any album.
  //
  // Derived rather than held in state because the album is already replaced on refetch and on a
  // settings broadcast — a copy would be a second source of truth that could only ever fall behind
  // it. `null` is still a real state, meaning the album has not arrived, and nothing renders a
  // negative answer until it has: that is what stopped a paying owner watching PRO badges sit on
  // their own features for the length of a request.
  const userTier: Tier | null = album?.plan ?? null

  const [mediaRadiusMax, setMediaRadiusMax] = useState(144)
  const [forceGlobalRadius, setForceGlobalRadius] = useState(false)
  const [slideshowRequestId, setSlideshowRequestId] = useState(0)
  const [arrangeMode, setArrangeMode] = useState(false)

  // Refs
  // ownerTokenFromUrlRef: did THIS page load come with an owner token in the URL?
  // Guaranteed set before isOwner can become true — see Effect 1 sequencing.
  // Prevents a stale HttpOnly cookie from granting owner view on a guest URL.
  const ownerTokenFromUrlRef = useRef(false)
  const settingsChannelRef = useRef<RealtimeChannel | null>(null)
  const prevGuestDownloadsRef = useRef<boolean | null>(null)
  const uploadRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // fetchGenRef: monotonic generation counter incremented on every slug change.
  // fetchAlbum captures myGen at call time; isCancelled() returns true if the
  // generation advanced past myGen (i.e. a newer slug navigation superseded this call).
  // This prevents a stale in-flight fetchAlbum from overwriting the new album's state.
  const fetchGenRef = useRef(0)

  // Server-hydration bookkeeping. `seededRef`: the server rendered this slug's album/gate, so the
  // first fetchAlbum is skipped (unless upgrading to owner view). `firstEffectRunRef` guards the
  // slug-reset effect so it doesn't wipe the seeded state on mount — only on real slug navigations.
  const seededRef = useRef<boolean>(!!initialAlbum || !!initialGate)
  const firstEffectRunRef = useRef(true)

  // Owner VIEW requires BOTH: verified ownership (isOwner, established authoritatively by a
  // successful owner-login token check — see Effect 1) AND this load arriving via the #owner=
  // management link (ownerTokenInUrl). A leftover owner cookie on the plain guest URL sets isOwner
  // but NOT ownerTokenInUrl, so the public URL stays a guest experience for everyone incl. the creator.
  const effectiveIsOwner = isOwner && ownerTokenInUrl

  // Owner view can only be known CLIENT-side (it requires the #owner= fragment, which a server
  // never receives), so a naive render shows the guest bar first and swaps to the owner toolbar a
  // moment later — a visible "guest view flash" every time an owner opens their own album.
  // Detecting the fragment in a LAYOUT effect (runs after DOM mutation but BEFORE paint) means the
  // guest bar is never actually painted for an owner; we hold a same-height placeholder until the
  // owner check resolves. Guests have no fragment, so this stays false and their bar still comes
  // straight from the server HTML with no delay and no layout shift.
  const [ownerHashPresent, setOwnerHashPresent] = useState(false)
  const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect
  useIsomorphicLayoutEffect(() => {
    const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
    if (new URLSearchParams(raw).get('owner')) setOwnerHashPresent(true)
    // NOTE: an earlier attempt at killing the "album is protected" flash held `loading` true here
    // for a gated album opened on an owner link, so the skeleton showed instead of the gate until
    // the owner check resolved. On production that never resolved and the album never opened at
    // all — a far worse failure than the flash it was fixing. Reverted; do not reintroduce without
    // a reproduction of the gated-owner path (see /wog0op5z#owner=…).
  }, [])
  // HOW LONG THE OWNER CHECK MAY HOLD THE PAGE BEFORE WE GIVE UP ON IT.
  //
  // This number is the entire difference between fixing the flash and repeating the outage. The
  // earlier attempt (see the note above) held `loading` true until the owner check resolved, with
  // no escape: on production it never resolved, so a gated album never opened at all. Waiting is
  // only safe if it is bounded.
  //
  // 4s covers a round trip plus the one retry the owner-login call makes, on a venue connection.
  // Past that the gate is shown — which is the correct answer for a guest and merely the old
  // annoyance for an owner, rather than a page that never arrives.
  const OWNER_CHECK_MAX_MS = 4000
  const [ownerCheckTimedOut, setOwnerCheckTimedOut] = useState(false)
  useEffect(() => {
    if (!ownerHashPresent || ownerTokenReady) return
    const t = window.setTimeout(() => setOwnerCheckTimedOut(true), OWNER_CHECK_MAX_MS)
    return () => window.clearTimeout(t)
  }, [ownerHashPresent, ownerTokenReady])

  const ownerUpgradePending = ownerHashPresent && !ownerTokenReady && !ownerCheckTimedOut

  // The inline script in page.tsx flags <html> when the URL carries an #owner= fragment, so CSS can
  // stop the server's guest render (guest bar / gate) painting before React ever runs. Clear the
  // flag the moment we know this visitor is NOT in owner view, so their guest chrome appears; and
  // on unmount, since a client-side navigation to another album never re-runs that script.
  useEffect(() => {
    if (ownerTokenReady && !effectiveIsOwner) delete document.documentElement.dataset.hushOwner
  }, [ownerTokenReady, effectiveIsOwner])
  useEffect(() => () => { delete document.documentElement.dataset.hushOwner }, [])

  // Show the album's custom URL in the address bar once it has one, so /wog0op5z becomes /tali
  // rather than the album answering on two addresses forever. The random slug still WORKS — QR codes
  // get printed and links get sent long before an owner thinks to set a custom URL, and breaking
  // those would strand guests at a 404 in front of a poster. It is only ever rewritten, never
  // rejected.
  //
  // This is deliberately NOT a server redirect. That was tried on 2026-08-19 and locked owners out
  // of their own albums: the account page links to /{random-slug}#owner={token} via a Next <Link>,
  // so the navigation is client-side, the router resolves the redirect itself and goes to the bare
  // Location value — dropping the fragment carrying the owner token. Every owner arrived as a guest.
  // A fragment is never sent to a server, so no redirect can preserve one; only the browser can.
  //
  // replaceState (not push) so Back still leaves the album instead of bouncing between two spellings
  // of the same page, and history.state is passed through untouched so Next's router keeps its own
  // navigation state — this changes what is displayed, nothing about where the app thinks it is.
  useEffect(() => {
    const custom = album?.custom_slug
    if (!custom) return
    const path = window.location.pathname.replace(/^\/+/, '').replace(/\/+$/, '')
    if (decodeURIComponent(path).toLowerCase() === custom) return
    window.history.replaceState(
      window.history.state,
      '',
      `/${custom}${window.location.search}${window.location.hash}`,
    )
  }, [album?.custom_slug])

  // Tombstone recently-deleted photo IDs so a realtime reconnect/refetch (common on mobile)
  // cannot reinstate a photo the user just deleted. Auto-expires after 60s.
  const deletedIdsRef = useRef<Map<string, number>>(new Map())
  const isRecentlyDeleted = useCallback((id: string) => {
    const t = deletedIdsRef.current.get(id)
    if (t == null) return false
    if (Date.now() - t > 60_000) { deletedIdsRef.current.delete(id); return false }
    return true
  }, [])

  // ─── fetchPhotos ────────────────────────────────────────────────────────────
  // Returns the photos array instead of calling setPhotos directly.
  // This lets callers gate the state update with their own cancellation guard
  // (generation counter for fetchAlbum; active flag for the realtime channel).

  // Fetch ONE window (offset/limit) of photos + the true total, via the authenticated API route
  // (admin client, server-side access check) rather than the anon client. The anon client can only
  // read photos of OPEN albums (RLS), so gated albums — and the owner's own view of them — came
  // back empty. The route returns photos when the caller is owner, an unlocked guest, or open.
  // NULL MEANS "ASK AGAIN LATER", NOT "THE ALBUM IS EMPTY".
  //
  // This used to return `{ photos: [], total: 0 }` on any failure, and every caller treated that as
  // a real answer: applyWindowRefresh saw 0 <= ALBUM_FIRST_WINDOW and did setPhotos([]), so one bad
  // response BLANKED the guest's album until the next ping.
  //
  // That is not hypothetical at an event. This route allows 600 requests a minute per
  // cf-connecting-ip, and 300 guests on venue wifi share one — so the moment the limit is reached
  // the punishment is every screen in the room going empty at once, which is the worst possible
  // moment for it and looks exactly like the product losing the photos.
  //
  // Failing to refresh is invisible. Blanking is a catastrophe. So a failure now returns null and
  // callers keep what they already have.
  const fetchPage = useCallback(async (albumId: string, offset: number, limit: number): Promise<{ photos: Photo[]; total: number } | null> => {
    try {
      const res = await fetch(`/api/album/photos?albumId=${encodeURIComponent(albumId)}&offset=${offset}&limit=${limit}`, { cache: 'no-store' })
      if (!res.ok) {
        console.error('[AlbumPageClient] fetchPage failed', res.status)
        return null
      }
      const json = await res.json() as { photos?: Photo[]; total?: number }
      // Drop any photo the user just deleted — guards against a stale/racing refetch reinstating it.
      const list = (json.photos ?? []).filter(p => !isRecentlyDeleted(p.id))
      return { photos: list, total: typeof json.total === 'number' ? json.total : list.length }
    } catch (e) {
      console.error('[AlbumPageClient] fetchPage error', e)
      return null
    }
  }, [isRecentlyDeleted])

  // First-window fetch (offset 0) — used by the initial load and every realtime refetch.
  const fetchPhotos = useCallback((albumId: string) => fetchPage(albumId, 0, ALBUM_FIRST_WINDOW), [fetchPage])

  // What the album looked like the last time we actually pulled the window. Compared against the
  // cheap probe so an unchanged album costs ~40 bytes instead of ~228 KB — see lib/album-freshness.
  // SEEDED FROM THE SERVER RENDER. The page arrives with the window already in its HTML, so the
  // client knows exactly how fresh it is — and the refetch that fires the moment realtime
  // subscribes then finds nothing changed and skips, instead of pulling the same ~228 KB a second
  // time one second after load. At 400 arrivals that duplicate alone was ~90 MB and 400 heavy
  // queries in the arrival window.
  const seenFreshnessRef = useRef<AlbumFreshness | null>(
    // ONLY when the server-rendered window is known to contain the newest photo.
    //
    // initialPhotos is the first WINDOW (500), ordered by the album's own photo_order. On a
    // newest-first album that window holds the newest row, so its max created_at is the album's.
    // On an oldest-first or hand-arranged album past 500 photos it is the 500 OLDEST rows, whose
    // max is nowhere near — seeding from it guaranteed a mismatch on the very first probe and
    // pulled the whole window anyway, which is precisely the duplicate fetch the seed exists to
    // avoid. Below the window size every ordering holds the whole album, so any of them is safe.
    initialPhotos && typeof initialTotal === 'number' &&
    (album?.photo_order === 'newest' || initialPhotos.length >= initialTotal)
      ? {
          total: initialTotal,
          // max, not [0] — even a newest-first window must not assume the array's own order.
          latest: initialPhotos.reduce<string | null>(
            (max, p) => (!max || p.created_at > max ? p.created_at : max), null),
        }
      : null,
  )

  const probeAlbum = useCallback(async (albumId: string): Promise<AlbumFreshness | null> => {
    try {
      const res = await fetch(`/api/album/photos?albumId=${encodeURIComponent(albumId)}&probe=1`, { cache: 'no-store' })
      if (!res.ok) return null
      const j = await res.json() as { total?: number; latest?: string | null }
      if (typeof j.total !== 'number') return null
      return { total: j.total, latest: j.latest ?? null }
    } catch {
      // A probe that did not come back knows nothing; albumChanged treats null as "fetch".
      return null
    }
  }, [])

  const fetchSince = useCallback(async (albumId: string, since: string, limit: number): Promise<{ photos: Photo[]; total: number } | null> => {
    try {
      const res = await fetch(
        `/api/album/photos?albumId=${encodeURIComponent(albumId)}&since=${encodeURIComponent(since)}&limit=${limit}`,
        { cache: 'no-store' },
      )
      if (!res.ok) return null
      const json = await res.json() as { photos?: Photo[]; total?: number }
      if (typeof json.total !== 'number') return null
      return { photos: (json.photos ?? []).filter(p => !isRecentlyDeleted(p.id)), total: json.total }
    } catch {
      return null
    }
  }, [isRecentlyDeleted])

  // Merge new arrivals into what is already on screen, WITHOUT reordering anything else.
  //
  // mergePreservingExtras puts the incoming rows first, which is right for a newest-first album
  // and wrong for every other order — so the merged list is sorted the way the album is. The
  // window path does not need this because the server returns it already ordered.
  const applyDelta = useCallback((fresh: { photos: Photo[]; total: number }) => {
    setTotal(fresh.total)
    setPhotos(prev => {
      const have = new Set(prev.map(p => p.id))
      const added = fresh.photos.filter(p => !have.has(p.id))
      if (added.length === 0) return prev
      const merged = [...added, ...prev]
      if (albumOrderRef.current === 'oldest') {
        merged.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      } else if (albumOrderRef.current !== 'manual') {
        merged.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
      }
      return merged
    })
  }, [])

  // Refresh the window, asking the cheap question first EXCEPT when we were told something
  // changed.
  //
  // The probe compares {total, latest}, which catches arrivals and departures but not an edit in
  // place — and a REORDER moves neither. So a broadcast, which only ever fires because something
  // actually changed, must not be answered with "the counts look the same, never mind": an owner
  // rearranging an album would have had every other viewer keep the old order for the rest of
  // their session, with nothing to heal it until the next upload.
  //
  // This costs almost nothing. An upload moves the count, so the probe would have fetched anyway;
  // the only broadcasts this adds a fetch for are reorders and settings changes, which are rare
  // and deliberate. The polling path — the one running on every viewer past the realtime cap, and
  // the reason the probe exists — still probes.
  const refreshIfChanged = useCallback(async (
    albumId: string,
    apply: (r: { photos: Photo[]; total: number } | null) => void,
    opts: { force?: boolean } = {},
  ) => {
    const probe = await probeAlbum(albumId)
    if (!opts.force && !albumChanged(seenFreshnessRef.current, probe)) return

    // ASK FOR WHAT IS MISSING, NOT FOR EVERYTHING.
    //
    // The probe made an idle album free; measuring a real event showed the live case was still
    // pulling the whole 500-row window — 424 KB — on nearly every check, because during an event
    // the album genuinely has changed. At a thousand guests that is the entire monthly database
    // transfer allowance in one afternoon. When the only difference is a few new photos, this
    // fetches those few. deltaRowsNeeded returns null for anything it cannot express safely —
    // a deletion, an edit in place, a gap too large — and then the window is fetched as before.
    const delta = deltaRowsNeeded(seenFreshnessRef.current, probe, ALBUM_DELTA_MAX)
    if (delta !== null && seenFreshnessRef.current?.latest) {
      const fresh = await fetchSince(albumId, seenFreshnessRef.current.latest, delta)
      // A delta that came back with exactly what the probe promised is trustworthy; anything else
      // (a short read, a failure, a count that moved underneath) falls through to the full window
      // rather than leaving the grid quietly wrong.
      if (fresh && fresh.photos.length === delta && fresh.total === probe?.total) {
        seenFreshnessRef.current = probe
        applyDelta(fresh)
        return
      }
    }

    const r = await fetchPhotos(albumId)
    // Only record freshness on a fetch that actually succeeded, or a failed window would be
    // remembered as the current state and the next probe would skip the retry.
    if (r && probe) seenFreshnessRef.current = probe
    apply(r)
  }, [probeAlbum, fetchPhotos])

  // Load the next page of a BIG album's tail (appended after what's loaded). Self-gates on refs so
  // it's safe from a button or a scroll observer without stale-closure bugs. No-op once caught up.
  const loadMore = useCallback(async () => {
    const albumId = albumIdRef.current
    if (!albumId || loadingMoreRef.current) return
    if (photosLenRef.current >= totalRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const r = await fetchPage(albumId, photosLenRef.current, LOAD_MORE_PAGE)
      // Same rule: a failed page must not rewrite the total to 0 and make the album look empty.
      if (!r) return
      setTotal(r.total)
      setPhotos(prev => {
        const have = new Set(prev.map(p => p.id))
        const add = r.photos.filter(p => !have.has(p.id))
        return add.length ? [...prev, ...add] : prev
      })
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [fetchPage])

  // SEARCH MUST SEE THE WHOLE ALBUM, not just what has been scrolled to.
  //
  // Bib search matched against `photos` — the LOADED window. That is fine at 900 photos and
  // silently wrong at 5,000: with a first window of 2,000, a runner whose photos sit at #3,400
  // types their number and is told there are none. It does not look like a bug to them. It looks
  // like they were not photographed.
  //
  // The obvious fix — load all 5,000 rows into every phone so the filter can see them — is 3-4 MB
  // of JSON per guest over the one WiFi the whole finish area is sharing, and it makes the phone
  // parse and hold the entire album to answer a question about thirty photos. So the DATABASE
  // searches instead: one GIN-indexed lookup over bib_numbers, complete on any album size.
  //
  // The local filter still runs on every keystroke, because it is instant and needs no network.
  // The server's answer replaces it the moment it lands. On a small album they are identical; on a
  // big one the local pass is a fast first draft of the real answer.
  const albumId = album?.id ?? null
  const bibEnabled = !!album?.bib_search_enabled
  const [bibResult, setBibResult] = useState<{ query: string; photos: Photo[]; total: number } | null>(null)
  const [bibStats, setBibStats] = useState<{ indexed: number; totalImages: number } | null>(null)
  // THE NUMBER THAT FAILED, not a boolean. Tagged the same way bibResult is, and for the same
  // reason: a failure belongs to the query that produced it. As a flag it had to be cleared, the
  // only place clearing it was inside .then(), and a failed search for "123" followed by typing
  // "1234" showed "Could not search just now" against a number nothing had attempted yet. Tagging
  // it makes that state unrepresentable instead of remembering to reset it.
  const [bibFailedQuery, setBibFailedQuery] = useState<string | null>(null)
  // Bumped by the retry button. The effect keys on the digits, so without this, retrying the SAME
  // number after a failure fires nothing at all and the runner is stuck on the failure.
  const [bibRetry, setBibRetry] = useState(0)

  const bibDigits = bibQuery.replace(/\D/g, '')
  // A bib filter is on screen: the grid is short, so the "load more" sentinel sits in view and the
  // observer keeps firing — paging the whole 5,000-photo album across the venue WiFi while the
  // runner looks at twelve photos. The server already gave the complete answer; there is nothing
  // left for those rows to contribute.
  const bibFilterActive = bibEnabled && !!bibDigits

  // "We do not have an answer for the number currently in the box." Derived, not a loading flag,
  // and that distinction is the whole point.
  //
  // The obvious fix for the flicker below is to skip the refetch when the same number is searched
  // twice — which trades a flicker for a stale answer, and during a live race a stale answer is the
  // failure: a runner who searched at minute 1 and again at minute 5 would be shown the two photos
  // that existed the first time and never the eight that exist now. So the request always goes, and
  // what changes is that an answer already on screen is not taken away while the next one arrives.
  //
  // Because this is false whenever a result for THIS number is held, a background refresh cannot
  // push the bar back through "Searching…" or, worse, through the "no photos with that number"
  // panel — presented as final, then withdrawn — which is what a plain in-flight flag did.
  const bibFailed = bibEnabled && !!bibDigits && bibFailedQuery === bibDigits
  const bibAwaitingServer = bibEnabled && !!bibDigits && bibResult?.query !== bibDigits && !bibFailed

  useEffect(() => {
    if (!bibEnabled || !albumId) return
    let cancelled = false
    const controller = new AbortController()
    // Debounced so typing "1234" is one request, not four. 300ms is below the point a person
    // notices a pause and above a fast typist's gap between digits.
    const timer = window.setTimeout(() => {
      const url = bibDigits
        // LIMITED. OCR reads every number in the frame, so a banner year like "2026" is a real
        // stored value; without a cap, typing it returns up to 2,000 full rows. No runner is in 300
        // photos, so nothing legitimate is lost.
        //
        // NO bibStats HERE. Those are two full count scans, and the numbers they return cannot
        // change between one keystroke and the next — sending them per search meant four round
        // trips per number typed, three of which returned what we already knew. The empty-box
        // request below fetches them, which is every page load.
        ? `/api/album/photos?albumId=${encodeURIComponent(albumId)}&bib=${encodeURIComponent(bibDigits)}&limit=${BIB_RESULT_LIMIT}`
        : `/api/album/photos?albumId=${encodeURIComponent(albumId)}&bibStats=1&statsOnly=1`
      fetch(url, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((json: { photos?: Photo[]; total?: number; bibStats?: { indexed: number; totalImages: number } }) => {
          if (cancelled) return
          if (json.bibStats) setBibStats(json.bibStats)
          // A stats-only reply carries no photos and must not be mistaken for "no matches".
          if (!bibDigits) return
          // Tagged with the query it answers. Without that, a slow response for "12" can land
          // after a fast one for "1234" and show the wrong runner's photos — the classic
          // out-of-order search race, and the one people photograph and send you.
          // `total` is the TRUE match count even when the rows were capped, so the bar can say
          // "showing the first 300 of 1,847" instead of presenting 300 as the whole answer.
          const rows = json.photos ?? []
          setBibResult({ query: bibDigits, photos: rows, total: json.total ?? rows.length })
        })
        .catch((err: unknown) => {
          if (cancelled || (err as { name?: string })?.name === 'AbortError') return
          // SAYING SO IS THE POINT. Falling back to the local filter looks harmless and is not: it
          // filters the loaded window, finds nothing, and the bar states "No photos found" with
          // full confidence to a runner who is in twelve photos. One 429 on a shared venue IP, or
          // one dropped packet, is enough. An honest "couldn't search, try again" is the only
          // answer here that is not a lie.
          if (bibDigits) setBibFailedQuery(bibDigits)
        })
    }, bibDigits ? 300 : 0)
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [bibEnabled, albumId, bibDigits, bibRetry])

  // The bib result rows, kept in step with the album. Built here, above the hooks boundary, and
  // memoised: it used to be a `.map` + `.find` in the render body, which at a capped 300 rows
  // against a fully-loaded 5,000-photo album is 1.5M id comparisons on EVERY re-render — and this
  // component re-renders on every realtime ping and every refetch.
  const photosById = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos])
  const bibServerAnswered = bibResult !== null && bibResult.query === bibDigits
  const albumFullyLoaded = total <= 0 || photos.length >= total
  const bibServerPhotos = useMemo(() => {
    if (!bibResult) return []
    const out: Photo[] = []
    for (const row of bibResult.photos) {
      // A photo deleted in this tab, tombstoned exactly as every other fetch result is.
      if (isRecentlyDeleted(row.id)) continue
      const live = photosById.get(row.id)
      // Prefer the loaded copy: it is the one caption edits, radius changes and hides reach.
      if (live) { out.push(live); continue }
      // Not in the loaded window. If the whole album IS loaded, its absence means it was deleted
      // or hidden somewhere else — the search result is a snapshot and would otherwise keep
      // showing it, and open it in the lightbox on a URL that no longer resolves.
      if (!albumFullyLoaded) out.push(row)
    }
    return out
  }, [bibResult, photosById, isRecentlyDeleted, albumFullyLoaded])

  // Infinite scroll: auto-load the next page as the sentinel nears view. loadMore self-gates, so
  // firing on every intersection is safe; the visible button is the manual fallback. The sentinel
  // only renders while more remain, so when caught up the observer detaches. rootMargin prefetches.
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = loadMoreSentinelRef.current
    if (!el || totalRef.current <= ALBUM_FIRST_WINDOW || totalRef.current <= photosLenRef.current) return
    const io = new IntersectionObserver(entries => { if (entries[0]?.isIntersecting) void loadMore() }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
    // bibFilterActive is a dep because the sentinel ELEMENT is unmounted while a bib filter is on
    // screen. Without it: search a number, the sentinel goes away, clear the box and a NEW sentinel
    // element mounts — but `total` and `photos.length` have not changed, so this never re-runs and
    // the observer stays pointed at a detached node. Auto-load is then dead for the rest of the
    // session. It self-heals during an upload burst (total moves every 2.5s) and does not once the
    // photographer stops, which is most of the time anyone is browsing.
  }, [loadMore, total, photos.length, bibFilterActive])

  // Apply a first-window refetch (realtime). Small album (fits the window) → plain replace, exactly
  // the pre-pagination behaviour. Big album → merge so the already-loaded tail survives the refresh.
  const applyWindowRefresh = useCallback((r: { photos: Photo[]; total: number } | null) => {
    // A failed fetch is not an empty album — see fetchPage. Keep what is on screen.
    if (!shouldApplyRefresh(r)) return
    setTotal(r.total)
    setPhotos(prev => applyPhotoWindow(prev, r.photos, r.total, ALBUM_FIRST_WINDOW))
  }, [])

  // ─── fetchAlbum ─────────────────────────────────────────────────────────────

  const fetchAlbum = useCallback(async (): Promise<void> => {
    if (!ownerTokenReady) return

    // The server already rendered this slug's album/gate. Skip the initial client fetch — unless
    // we're upgrading to owner view (the #owner= fragment is present, which the server couldn't
    // see). Consumed once: any later call (gate unlock, navigation, retry, realtime) is a real fetch.
    if (seededRef.current) {
      seededRef.current = false
      if (!ownerTokenFromUrlRef.current) {
        setLoading(false)
        return
      }
    }

    // Capture generation at call time. isCancelled() returns true if a slug
    // change advanced fetchGenRef.current past this value while we were awaiting.
    const myGen = fetchGenRef.current
    const isCancelled = () => fetchGenRef.current !== myGen

    setPasswordGate(null)
    setRevealGate(null)

    // checkOwnerAuth is defined inside fetchAlbum so it closes over isCancelled.
    // This prevents it from updating state after a slug navigation supersedes this call.
    async function checkOwnerAuth(albumSlug: string): Promise<void> {
      try {
        const res = await fetch('/api/album/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: albumSlug }),
        })
        if (isCancelled() || !res.ok) return
        const result = await res.json() as { isOwner?: boolean }
        if (isCancelled()) return
        // Do NOT set ownerTokenFromUrlRef here. Owner VIEW requires the #owner= management link
        // in the current URL (the ref is set only by Effect 1 when that hash is present). A valid
        // owner cookie alone authorizes owner mutations but does not flip the public album URL
        // into owner view — the public URL is a guest experience for everyone, including the
        // creator. The creator reaches owner view via their management link (dashboard / post-create).
        //
        // Only ever UPGRADE to owner here, never downgrade: Effect 1 already resets isOwner=false per
        // load and sets it true when owner-login verifies the token. A racing/failed auth call
        // returning isOwner:false must not flip a verified owner back to guest — that was the
        // "sometimes owner, sometimes guest" flakiness. On a guest URL this is harmless (gated by
        // ownerTokenInUrl in effectiveIsOwner).
        if (result.isOwner) setIsOwner(true)
      } catch {
        // Auth failure = guest view, no action needed
      }
    }

    try {
      // owner=1 only when this load is via the #owner= management link — so a leftover owner
      // cookie on the plain guest URL doesn't bypass the reveal/password gates.
      const res = await fetch(
        `/api/album/resolve?slug=${encodeURIComponent(slug)}&owner=${ownerTokenFromUrlRef.current ? '1' : '0'}`,
        { cache: 'no-store' },
      )
      if (isCancelled()) return

      const json = await res.json().catch(() => ({})) as Record<string, unknown>
      if (isCancelled()) return

      // Real not-found (album deleted or never existed) — checked BEFORE body flags so that
      // a security-minded API returning 404+password_required cannot create an infinite gate
      // loop where the user is prompted for a password that can never succeed
      if (res.status === 404) {
        setIsNotFound(true)
        return
      }

      // Transient server error
      if (!res.ok) {
        setNetworkError(true)
        return
      }

      // Password gate — 200 with password_required flag
      if (json.password_required === true) {
        if (typeof json.slug !== 'string' || typeof json.title !== 'string') {
          setNetworkError(true)
          return
        }
        setPasswordGate({ slug: json.slug, title: json.title })
        return
      }

      // Reveal gate — 200 with locked flag + reveal_at
      if (json.locked === true && json.reveal_at) {
        if (typeof json.slug !== 'string' || typeof json.title !== 'string' || typeof json.reveal_at !== 'string') {
          setNetworkError(true)
          return
        }
        setRevealGate({ revealAt: json.reveal_at, slug: json.slug, title: json.title })
        return
      }

      // Malformed full-album response (gate responses handled above legitimately have no id)
      if (typeof json.id !== 'string') {
        setNetworkError(true)
        return
      }

      // Full album — resolve strips owner_token, password_hash, user_id, retired_at
      const data = json as unknown as Album

      // Auth check and photo fetch in parallel. Both results are guarded below by
      // isCancelled() so a superseded call never commits state to the new album.
      // setAlbum is intentionally AFTER Promise.all so a slug change that completes
      // while we await never flashes the old album title before the isCancelled guard fires.
      const [, photoData] = await Promise.all([
        checkOwnerAuth(data.slug),
        fetchPhotos(data.id),
      ])
      if (isCancelled()) return
      setAlbum(data)
      // photoData is null when the photos request failed. The ALBUM still loaded, so show it —
      // with whatever photos are already on screen — rather than an empty grid that reads as "your
      // photos are gone". The next broadcast, or the SUBSCRIBED handler, fills it in.
      if (photoData) {
        setPhotos(photoData.photos)
        setTotal(photoData.total)
      }
      // Remember this album on the device whenever we're on its owner link, so the owner can
      // always get back to management view (read the token fresh from the hash — it's kept there).
      if (ownerTokenFromUrlRef.current) {
        const tok = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('owner')
        if (tok) rememberOwnedAlbum(data.slug, tok, data.title)
      }
    } catch {
      // fetch() threw — network down, DNS failure, etc.
      if (!isCancelled()) setNetworkError(true)
    } finally {
      if (!isCancelled()) setLoading(false)
    }
  }, [slug, ownerTokenReady, fetchPhotos])

  // ─── Effect 1: Owner token resolution ───────────────────────────────────────
  // Deps: [slug] — runs whenever the route slug changes
  useEffect(() => {
    // Advance the fetch generation FIRST. Any in-flight fetchAlbum from the previous
    // slug will see fetchGenRef.current !== myGen and skip all remaining setState calls.
    fetchGenRef.current++

    // Cancel any pending upload-triggered refetch from the previous album.
    // Without this, a 3s timer from album A would call fetchPhotos(oldAlbumId)
    // while album B is loaded, overwriting album B's photos with album A's.
    if (uploadRefetchTimerRef.current) {
      clearTimeout(uploadRefetchTimerRef.current)
      uploadRefetchTimerRef.current = null
    }

    // Synchronously reset state for the new slug before any async work.
    // App Router re-renders the same component instance on slug changes — it
    // does NOT unmount/remount — so stale state from the previous album must
    // be explicitly cleared here.
    // EXCEPTION: on the very first run, if the server seeded this slug's album/gate, keep it —
    // wiping it would blank the page and throw away the SSR. Real slug navigations reset fully.
    const isFirstRun = firstEffectRunRef.current
    firstEffectRunRef.current = false
    const keepSeeded = isFirstRun && seededRef.current

    if (!keepSeeded) {
      setLoading(true)
      setIsNotFound(false)
      setNetworkError(false)
      setAlbum(null)
      setPhotos([])
      setPasswordGate(null)
      setRevealGate(null)
    }

    // Owner + display state is always re-derived per load.
    setIsOwner(false)
    setOwnerToken(null)
    setOwnerTokenReady(false)
    ownerTokenFromUrlRef.current = false
    setOwnerTokenInUrl(false)
    prevGuestDownloadsRef.current = null
    // Reset display state that persists across navigations
    setArrangeMode(false)
    setForceGlobalRadius(false)
    setSlideshowRequestId(0)
    setMediaRadiusMax(144)
    // BIB STATE IS PER ALBUM. Left behind on a client-side album-to-album navigation, the query
    // still matched its own cached result, so the new album's grid rendered the PREVIOUS album's
    // photo rows until the next response landed — and its indexing counts with them.
    setBibQuery('')
    setBibResult(null)
    setBibStats(null)
    setBibFailedQuery(null)

    let cancelled = false

    const rawHash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash
    const token = new URLSearchParams(rawHash).get('owner')

    if (!token) {
      setOwnerTokenReady(true)
      return () => { cancelled = true }
    }

    // Mark this load as owner-initiated BEFORE ownerTokenReady is set.
    // This guarantees the ref is true whenever fetchAlbum and checkOwnerAuth run.
    ownerTokenFromUrlRef.current = true
    setOwnerTokenInUrl(true)
    setOwnerToken(token)

    // Intentionally KEEP #owner=<token> in the URL. Owner view now requires the token in the
    // URL (a bare cookie no longer flips the public link into owner view), so stripping it
    // would drop the owner back to guest view on refresh. The token lives in the URL *fragment*,
    // which browsers never send in the Referer header or to the server — so this is the distinct,
    // persistent management link the owner keeps private (guest link = same path with no #owner=).

    void (async () => {
      // owner-login sets the hushare_owner_<albumId> cookie (7 days) that flips this load into
      // owner view. Retry once on a TRANSIENT failure (network/timeout/429/5xx): a single blip
      // used to silently drop the owner to guest view — the reported "sometimes owner, sometimes
      // guest" flakiness. A definitive 403/404 (wrong token / album gone) is not retried. If the
      // cookie was already set on a prior visit, a failure here is harmless — auth still sees it.
      let ownerLoginOk = false
      for (let attempt = 0; attempt < 2; attempt++) {
        // 10s timeout per attempt: if owner-login hangs, fall through rather than block the page.
        const ac = new AbortController()
        const timeoutId = setTimeout(() => ac.abort(), 10_000)
        try {
          const res = await fetch('/api/album/owner-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug, owner_token: token }),
            signal: ac.signal,
          })
          clearTimeout(timeoutId)
          if (res.ok) { ownerLoginOk = true; break }  // token verified — authoritative proof of ownership
          if (res.status === 403 || res.status === 404) break  // definitively not owner / album gone
          // 429 / 5xx — fall through to retry
        } catch {
          clearTimeout(timeoutId)  // network error or timeout — fall through to retry
        }
        if (attempt === 0) await new Promise(r => setTimeout(r, 600))
      }
      if (cancelled) return
      // owner-login verified the 256-bit owner_token against this album, so its success is
      // authoritative proof of ownership — establish owner view directly here rather than relying
      // solely on the separate cookie-based /api/album/auth check in fetchAlbum, which could race the
      // cookie write and flip the owner back to guest ("sometimes owner, sometimes management").
      if (ownerLoginOk) setIsOwner(true)
      setOwnerTokenReady(true)
    })()

    return () => { cancelled = true }
  }, [slug])

  // ─── Effect 1b: Restore owner view after the "save your album" Google sign-in ─
  // The Google round-trip drops the #owner= fragment (fragments never reach the server), so the
  // owner would otherwise land back in GUEST view of their own album. We flagged the return URL
  // with ?owner_saved=1; here we rebuild the owner link from the token remembered in localStorage
  // and reload into it — which restores owner view AND auto-claims the album to their new account
  // (verifyOwnerViaCookie → claimAlbumIfNeeded fires on the /api/album/auth load).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('owner_saved') !== '1') return
    const token = getMyAlbums().find((a) => a.slug === slug)?.token
    if (token) {
      window.location.replace(`/${slug}#owner=${encodeURIComponent(token)}`)
    } else {
      // No remembered token (rare) — just strip the flag; they're signed in and the album will
      // claim itself the next time they open their owner link.
      window.history.replaceState(null, '', `/${slug}`)
    }
  }, [slug])

  // ─── Effect 2: Trigger fetchAlbum ───────────────────────────────────────────
  // fetchAlbum guards on ownerTokenReady internally, so this fires twice when
  // ownerTokenReady goes false → true, but only the second call does real work.
  useEffect(() => {
    void fetchAlbum()
  }, [fetchAlbum])

  // ─── Effect 3: Realtime photos channel ──────────────────────────────────────
  // INSERTs (guest uploads — the high-frequency, bursty event) arrive via Supabase BROADCAST:
  // photos/create sends a contentless "changed" ping and we DEBOUNCE-refetch. This replaced the
  // postgres_changes INSERT listener, which dropped ~93% of events to 150 viewers under a burst.
  // DELETE/UPDATE (rare owner actions) stay on postgres_changes for instant, per-row feedback.
  useEffect(() => {
    if (!album?.id) return
    const albumId = album.id
    let active = true
    let retryCount = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let refetchTimer: ReturnType<typeof setTimeout> | null = null
    let currentChannel: RealtimeChannel | null = null
    // Fallback poll — runs ONLY while the channel is down. The backoff below handles drops;
    // this handles REFUSAL (venue networks that block websockets, or the realtime service at
    // its concurrent-connection cap on a heavy day). Without it those clients retry forever,
    // never reach SUBSCRIBED, never refetch — and the page silently freezes at first load.
    // Cadence and jitter are owned by lib/realtime-fallback.ts.
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    function pollWhileDown() {
      if (!active) return
      void refreshIfChanged(albumId, r => { if (active) applyWindowRefresh(r) })
      pollTimer = setTimeout(pollWhileDown, fallbackPollDelay())
    }

    function connect() {
      if (!active) return
      // Null out currentChannel BEFORE removing it. removeChannel makes the old channel fire
      // CLOSED into its own subscribe callback — SYNCHRONOUSLY when the socket can't push,
      // which is exactly the refused-websocket state. The identity guard in that callback
      // (`ch !== currentChannel`) only silences the echo if the reassignment has already
      // happened; with the old order, every retry's own teardown scheduled one MORE connect,
      // and reconnect loops accumulated for as long as a websocket-blocking network kept the
      // page open — then all drained as a refetch herd the moment connectivity returned.
      const prev = currentChannel
      currentChannel = null
      if (prev) supabase.removeChannel(prev)

      const ch = supabase
        // Channel name IS the broadcast topic the server sends to (`album:<id>`).
        .channel(`album:${albumId}`)
        .on('broadcast', { event: 'changed' }, () => {
          if (!active) return
          // Debounce: a burst of uploads sends many pings — collapse them into one refetch so
          // 50 uploads in 2s cost ~1 refetch, not 50 list rebuilds.
          //
          // 2.5s, not 500ms. THE THING THAT BREAKS AT A VENUE IS REQUEST COUNT, not bytes. This
          // route allows 600/min per cf-connecting-ip and 300 guests on one venue WiFi share a
          // single public IP, so they share one bucket. At 500ms each guest could issue up to 120
          // requests a minute; at 2.5s it is 24. That is the difference between 300 guests fitting
          // inside the ceiling and every screen in the room getting a 429 at once.
          //
          // The cost is that a new photo can take up to 2.5s to appear instead of 0.5s. Nobody
          // watching an album notices two seconds; everybody notices the album refusing to load.
          // JITTERED. Every viewer receives the broadcast within milliseconds of every other, so a
          // fixed delay makes 400 phones fetch in the same instant — the one hot path here that
          // had no jitter, while the reconnect backoff and the fallback poll both explain why
          // they do. The probe in refreshIfChanged means most of those wake-ups cost ~40 bytes.
          if (refetchTimer) clearTimeout(refetchTimer)
          refetchTimer = setTimeout(() => {
            // force: a broadcast means something DID change, and a reorder changes neither of the
            // two fields the probe compares. Skipping on "counts look the same" left every other
            // viewer on the old order until the next upload.
            void refreshIfChanged(albumId, r => { if (active) applyWindowRefresh(r) }, { force: true })
          }, Math.round(REFETCH_DEBOUNCE_MS * (0.75 + Math.random() * 0.5)))
        })
        // DELETE and UPDATE used to arrive on postgres_changes for instant per-row feedback. They
        // no longer do, and this is a SECURITY fix rather than a refactor: Supabase only delivers
        // postgres_changes to a client that can SELECT the table under RLS, so supporting it meant
        // granting anon SELECT on `photos`. The anon key ships in the page source, so that grant let
        // anyone enumerate every photo on the platform — 2,951 rows with working URLs — without
        // knowing a single album link. The grant is gone; delete/reorder/settings now emit the same
        // contentless `changed` broadcast that uploads already used, and the debounced refetch above
        // applies them. Costs a sub-second delay on the owner's own action. Do not reintroduce
        // postgres_changes here without a way to scope table reads to one album.

      // Assigned BEFORE subscribe so the identity guard below can never mistake this channel's
      // own first status event for a stale echo, however promptly the callback fires.
      currentChannel = ch
      ch.subscribe(status => {
          // The identity check is load-bearing: a channel replaced by a newer connect() still
          // fires CLOSED (and stray errors) into THIS callback. Without the check, a dead
          // channel's echo re-arms retry/poll timers that belong to its successor.
          if (!active || ch !== currentChannel) return
          if (status === 'SUBSCRIBED') {
            // Always refetch on subscribe: closes the race window between the initial
            // fetchPhotos call and when the channel becomes SUBSCRIBED. Photos uploaded
            // in that gap would be missed if we only refetch on reconnect.
            // The `active` guard on the .then() prevents updating state after cleanup.
            void refreshIfChanged(albumId, r => { if (active) applyWindowRefresh(r) })
            retryCount = 0
            // Realtime is back — the broadcast channel is the fresh-data path again.
            if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
          } else if (
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT' ||
            status === 'CLOSED'
          ) {
            // Exponential backoff: 2s, 4s, 8s, 16s, capped at 30s — with FULL jitter.
            //
            // Without the jitter every phone in the room reconnects on the same tick. A venue
            // access point does not drop one guest, it drops all of them at once, so 300 clients
            // see CHANNEL_ERROR in the same instant, all wait exactly 2000ms, and all come back
            // together — and each one refetches the whole album on SUBSCRIBED. That is one
            // synchronised burst against the origin at the moment the network is least able to
            // carry it, and if the burst itself fails they retry in lockstep at 4s, then 8s.
            //
            // Spreading each wait across half its nominal value turns one spike into a 1-30s
            // smear. Same reasoning, and the same 0.5 + random() form, as the upload retry path.
            const delay = Math.min(2000 * Math.pow(2, retryCount), 30_000) * (0.5 + Math.random() * 0.5)
            retryCount++
            // Clear before reassigning: CHANNEL_ERROR and TIMED_OUT can both arrive for one
            // failed join, and an overwritten-but-live timer is one extra reconnect loop. Each.
            if (retryTimer) clearTimeout(retryTimer)
            retryTimer = setTimeout(connect, delay)
            // First failure arms the fallback poll; `if (!pollTimer)` keeps reconnect attempts
            // from stacking a second loop. First poll waits a full jittered interval — the
            // initial page load already fetched, so there is nothing to catch up on yet.
            if (!pollTimer) pollTimer = setTimeout(pollWhileDown, fallbackPollDelay())
          }
        })
    }

    connect()

    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
      if (refetchTimer) clearTimeout(refetchTimer)
      if (pollTimer) clearTimeout(pollTimer)
      if (currentChannel) supabase.removeChannel(currentChannel)
    }
  }, [album?.id, supabase, refreshIfChanged, applyWindowRefresh])

  // ─── Effect 4: Realtime settings broadcast channel ──────────────────────────
  useEffect(() => {
    if (!album?.id) return
    const albumId = album.id
    // Use slug (not UUID) for the resolve endpoint — the route resolves by slug, not by id.
    const albumSlug = album.custom_slug ?? album.slug

    let disposed = false

    // Treat the broadcast as a trigger to re-fetch from the server rather than trusting the
    // payload directly. Supabase Realtime broadcast channels are unauthenticated — any tab that
    // knows the channel name can publish to it, so accepting payload values directly creates a
    // spoofing vector (UI-only impact, but misleads users about the album's current state).
    // Pass owner mode so a gated album (reveal/password) the owner is viewing comes back as the
    // full album, not the guest gate response.
    const refetchSettings = () => {
      // Re-checked here, not only at broadcast time: this runs from the trailing timer up to
      // SELF_EDIT_QUIET_MS later, and the Designer may have been opened in between.
      if (designerOpenRef.current) { settingsRefetchOwedRef.current = true; return }
      const startedAt = Date.now()
      void fetch(`/api/album/resolve?slug=${encodeURIComponent(albumSlug)}&owner=${ownerTokenFromUrlRef.current ? '1' : '0'}`, { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then((data: Album | null) => {
          if (!shouldCommitSettings(data, {
            disposed,
            requestStartedAt: startedAt,
            lastLocalEditAt: lastLocalAlbumPatchRef.current,
          })) return
          setAlbum(prev => prev ? { ...prev, ...data } : prev)
        })
        .catch(() => {})
    }

    refetchSettingsRef.current = refetchSettings

    const sync = createSettingsSync({
      quietMs: SELF_EDIT_QUIET_MS,
      // JITTERED. For a guest `lastLocalEditAt` is 0, so settings-sync answers "refetch" the
      // instant the broadcast lands — with no debounce and no spread. Every viewer receives that
      // broadcast within milliseconds of every other, so one owner nudging a Designer slider threw
      // a thousand simultaneous requests at a 900/minute ceiling and a share of the room got 429s.
      // Every other hot path in this file carries this reasoning; this one was missed.
      refetch: () => {
        const delay = Math.round(700 * (0.5 + Math.random() * 1.5))
        window.setTimeout(refetchSettings, delay)
      },
      markOwed: () => { settingsRefetchOwedRef.current = true },
    })

    const ch = supabase
      .channel(`album-settings-${albumId}`)
      .on('broadcast', { event: 'album_settings' }, () => {
        // Decision AND cancellation both live in lib/settings-sync.ts now — see that file for why
        // keeping them apart meant neither could be tested.
        sync.onBroadcast({
          designerOpen: designerOpenRef.current,
          now: Date.now(),
          lastLocalEditAt: lastLocalAlbumPatchRef.current,
        })
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') settingsChannelRef.current = ch
        else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') settingsChannelRef.current = null
      })

    return () => {
      disposed = true
      refetchSettingsRef.current = null
      sync.dispose()
      settingsChannelRef.current = null
      supabase.removeChannel(ch)
    }
  }, [album?.id, album?.custom_slug, album?.slug, supabase])

  // ─── Effect 4b: pay off a settings refetch deferred by the Designer ─────────
  // The owner's own edits are already persisted and already in state, so whatever comes back can
  // only be equal or newer. Without this the album would silently keep pre-Designer values.
  useEffect(() => {
    if (designerOpen || !settingsRefetchOwedRef.current) return
    settingsRefetchOwedRef.current = false
    refetchSettingsRef.current?.()
  }, [designerOpen])

  // ─── Effect 5: Broadcast guest downloads toggle (owner only) ────────────────
  // When the owner changes allow_guest_downloads, broadcasts to all guest tabs.
  // The strict equality guard prevents a re-broadcast loop: Effect 4 may update
  // album state from the broadcast, but the value matches prevRef so Effect 5 no-ops.
  useEffect(() => {
    if (!album || !effectiveIsOwner) return
    const current = album.allow_guest_downloads

    if (prevGuestDownloadsRef.current === null) {
      prevGuestDownloadsRef.current = current
      return
    }

    if (prevGuestDownloadsRef.current === current) return
    prevGuestDownloadsRef.current = current

    settingsChannelRef.current?.send({
      type: 'broadcast',
      event: 'album_settings',
      payload: { allow_guest_downloads: current },
    })
  }, [album?.allow_guest_downloads, album?.id, effectiveIsOwner])

  // ─── Effect 6: Cleanup upload timer on unmount ──────────────────────────────
  useEffect(() => {
    return () => {
      if (uploadRefetchTimerRef.current) clearTimeout(uploadRefetchTimerRef.current)
    }
  }, [])

  // ─── Effect 7: Owner "save your album" prompt — fires when they try to LEAVE ──
  // A signed-OUT owner who has added photos is one tap from losing management access, so when they
  // try to leave we offer a one-tap Google save. We use ONLY the two UNAMBIGUOUS "leaving" signals,
  // so the one-time prompt is never wasted by an accidental window-switch or the mouse brushing the
  // top edge (earlier versions fired on those and burned the prompt before the user clicked away):
  //   1. BACK button / swipe-back — we push a history entry; the first back press pops the modal
  //      instead of navigating. (A back-press that only closes the photo lightbox is ignored.)
  //   2. Clicking an in-app link that LEAVES the album (the Hushare logo → home, or any nav to
  //      another path) — caught in the CAPTURE phase before Next's <Link> runs; the destination is
  //      remembered so dismissing the prompt still takes them there.
  // Fires at most ONCE, is dismissible, and never shows to a signed-in owner (their album is
  // already claimed to their account, so there's nothing to save).
  const hasPhotos = photos.length > 0
  useEffect(() => {
    if (ownerPromptShownRef.current) return
    if (!effectiveIsOwner || !hasPhotos || !album?.id) return
    try {
      if (sessionStorage.getItem(`hushare.savePrompt.${album.id}`)) { ownerPromptShownRef.current = true; return }
    } catch { /* private mode — ignore */ }

    let cancelled = false
    let onPop: ((e: PopStateEvent) => void) | null = null
    let onClickCapture: ((e: MouseEvent) => void) | null = null

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled || session) return
      // Push a history entry so the first back press lands here (popstate) rather than leaving.
      try { window.history.pushState({ hushSave: true }, '') } catch { /* ignore */ }
      const trigger = () => {
        if (cancelled || ownerPromptShownRef.current) return
        // Never stack on top of another sign-in card already showing (e.g. a download prompt). We do
        // NOT consume the one-shot here, so the save prompt can still fire on a later, clean leave.
        if (document.querySelector('.hush-signin-card')) return
        ownerPromptShownRef.current = true
        setOwnerSavePromptOpen(true)
      }
      // Ignore a back-press that merely closes the photo lightbox: PhotoGrid pushes its own entry
      // ON TOP of ours, so closing it lands us back ON our entry (state.hushSave === true). A REAL
      // leave pops OUR entry and lands on the album entry below (no hushSave) — only then do we fire.
      // Ignore back-presses that only close the photo lightbox: whether OUR entry or the lightbox's
      // entry is the one landed on, it's not a real leave. Only a pop onto the album's base entry
      // (neither flag) fires the prompt.
      onPop = (e: PopStateEvent) => {
        const s = e.state as { hushSave?: boolean; hushLightbox?: boolean } | null
        if (s?.hushSave || s?.hushLightbox) return
        trigger()
      }
      // Clicking an in-app link that LEAVES the album (the logo → home, or any nav to another path).
      // Caught in the CAPTURE phase and stopImmediatePropagation'd so Next's <Link> never navigates;
      // the destination is remembered so dismissing still takes them there. Once the modal has shown
      // (ownerPromptShownRef), we stop interfering so every link works normally again.
      onClickCapture = (e: MouseEvent) => {
        if (ownerPromptShownRef.current) return
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        const anchor = (e.target as HTMLElement | null)?.closest?.('a')
        const href = anchor?.getAttribute('href')
        if (!anchor || !href) return
        // A download trigger (downloadPhoto / QR / zip create a hidden <a download> and .click() it —
        // that synthetic click bubbles here). It points at /api/... or a blob:, NOT a page the user is
        // leaving to, so never intercept it or we'd cancel the download and pop the modal instead.
        if (anchor.hasAttribute('download')) return
        if (anchor.target && anchor.target !== '_self') return  // opens a new tab/window — not a leave
        let dest: URL
        try { dest = new URL(href, window.location.href) } catch { return }
        // Only a real navigation to ANOTHER same-origin path counts (skip #hash, same-page, mailto/tel,
        // and external sites we can't pop over anyway).
        if (dest.origin !== window.location.origin || dest.pathname === window.location.pathname) return
        e.preventDefault()
        e.stopImmediatePropagation()
        pendingLeaveHrefRef.current = dest.href
        trigger()
      }
      window.addEventListener('popstate', onPop)
      document.addEventListener('click', onClickCapture, true)
    }).catch(() => { /* can't tell — don't arm */ })

    return () => {
      cancelled = true
      if (onPop) window.removeEventListener('popstate', onPop)
      if (onClickCapture) document.removeEventListener('click', onClickCapture, true)
    }
  }, [effectiveIsOwner, hasPhotos, album?.id, supabase])

  // Lock background scroll while the save-prompt modal is open (matches the lightbox / face finder).
  useEffect(() => {
    if (!ownerSavePromptOpen) return
    document.documentElement.classList.add('hush-scroll-locked')
    document.body.classList.add('hush-scroll-locked')
    return () => {
      document.documentElement.classList.remove('hush-scroll-locked')
      document.body.classList.remove('hush-scroll-locked')
    }
  }, [ownerSavePromptOpen])

  // ─── Callbacks ──────────────────────────────────────────────────────────────

  // Close the owner save-prompt. If it was opened by a click on a leave-link, honour that original
  // navigation now — they chose not to sign in, so let them go where they were headed.
  const dismissOwnerPrompt = useCallback(() => {
    setOwnerSavePromptOpen(false)
    const href = pendingLeaveHrefRef.current
    pendingLeaveHrefRef.current = null
    if (href) window.location.href = href
  }, [])

  const handlePhotosUploaded = useCallback(() => {
    if (!album?.id) return
    const albumId = album.id
    if (uploadRefetchTimerRef.current) clearTimeout(uploadRefetchTimerRef.current)
    // 3s delay: gives Realtime a chance to deliver INSERT events first.
    // If Realtime delivers them, this refetch is a no-op (overwrites with same data).
    uploadRefetchTimerRef.current = setTimeout(() => {
      uploadRefetchTimerRef.current = null
      // Merge instead of replace: Realtime may have delivered photos after the query was
      // issued but before it resolves — a full replace would briefly remove them
      // Through refreshIfChanged with force, rather than a bare fetch: forcing is right (an upload
      // definitely changed something) but the bare call never updated seenFreshnessRef, so the
      // uploader's very next probe disagreed with itself and pulled a full window for nothing.
      void refreshIfChanged(albumId, r => {
        // Null on failure — the uploader's own tiles are already on screen, so keeping them beats
        // replacing them with nothing.
        if (!shouldApplyRefresh(r)) return
        // ALWAYS merges, unlike the refresh above, and that difference is deliberate: realtime may
        // have delivered photos after this query was issued but before it resolved, and a replace
        // would briefly remove the uploader's own tiles from under them.
        setPhotos(prev => mergePreservingExtras(prev, r.photos))
        setTotal(r.total)
      }, { force: true })
    }, 3000)
  }, [album?.id, fetchPhotos])

  const handlePhotoDeleted = useCallback((photoId: string) => {
    deletedIdsRef.current.set(photoId, Date.now())  // tombstone against racing refetch
    setPhotos(prev => prev.filter(p => p.id !== photoId))
  }, [])

  const handleAlbumUpdated = useCallback((
    patch: Partial<Album>,
    options?: {
      forceGlobalRadius?: boolean
      resetRadiusOverrides?: boolean
      resetFilterOverrides?: boolean
    },
  ) => {
    // Every call here is an edit made in THIS tab (owner toolbar, designer, header, cover picker),
    // so it is always newer than anything a settings refetch can be carrying. Effect 4 reads this.
    lastLocalAlbumPatchRef.current = Date.now()
    setAlbum(prev => prev ? { ...prev, ...patch } : prev)
    if ('media_radius' in patch) {
      setForceGlobalRadius(!!options?.forceGlobalRadius)
    }
    if (options?.resetRadiusOverrides) {
      setPhotos(prev => prev.map(p => ({ ...p, display_radius: null })))
    }
    if (options?.resetFilterOverrides) {
      setPhotos(prev => prev.map(p => ({ ...p, display_filter: null })))
    }
  }, [])

  const handlePhotoUpdated = useCallback((photoId: string, patch: Partial<Photo>) => {
    if (patch.display_radius !== undefined) setForceGlobalRadius(false)
    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, ...patch } : p))
  }, [])

  const handlePhotosReordered = useCallback((nextPhotos: Photo[]) => {
    setPhotos(nextPhotos)
  }, [])

  // ─── Rules of Hooks boundary ─────────────────────────────────────────────────
  // notFound() MUST be called after all hooks. It throws a Next.js signal that
  // skips the remaining render. Calling it before useCallback/useEffect would
  // violate Rules of Hooks by conditionally skipping hooks on subsequent renders.
  if (isNotFound) notFound()

  // ─── Render gates ────────────────────────────────────────────────────────────

  // The curtain has to be here TOO — this is the branch that is actually on screen for the whole
  // unlock. onUnlocked sets loading = true, which lands the very next render right here, above every
  // other gate. Without the curtain the overlay was unmounted the instant the countdown ended, the
  // skeleton showed for the entire 1.1-1.3s fetch, and a fresh curtain then mounted and played from
  // the start — which is exactly what "skeleton, then the animation, then the album" was.
  //
  // Three earlier fixes went to the revealGate, !album and main branches. The render never reached
  // any of them while this one was returning.
  // THE OWNER MUST NOT BE ASKED FOR THEIR OWN ALBUM'S PASSWORD.
  //
  // The owner token lives in the URL *fragment*, which browsers never send to a server. So the
  // server render of a gated album is always the guest one — the password prompt, or "not revealed
  // yet" — and the owner sees it for as long as the client takes to read the fragment and check the
  // token. Their own album, telling them they cannot come in.
  //
  // Holding the skeleton over that window is safe now only because the wait is bounded above; the
  // unbounded version of this is what took gated albums offline once already.
  const holdingForOwnerCheck = shouldHoldForOwnerCheck({
    ownerHashPresent, ownerTokenReady, ownerCheckTimedOut,
    hasGate: passwordGate !== null || revealGate !== null,
  })

  if (loading || holdingForOwnerCheck) {
    return (
      <>
        <AlbumSkeleton />
        {curtain && <RevealCurtain ready={false} onDone={() => setCurtain(false)} />}
      </>
    )
  }

  if (networkError) {
    return (
      <div
        className="min-h-dvh flex flex-col items-center justify-center gap-5 px-6 text-center"
        style={{ background: '#FDFAF5' }}
      >
        <p style={{ color: '#630826', fontSize: '1rem', fontWeight: 500 }}>
          Something went wrong. Please check your connection and try again.
        </p>
        <button
          type="button"
          onClick={() => {
            if (uploadRefetchTimerRef.current) {
              clearTimeout(uploadRefetchTimerRef.current)
              uploadRefetchTimerRef.current = null
            }
            fetchGenRef.current++  // cancel any in-flight fetchAlbum before retrying
            setNetworkError(false)
            setLoading(true)
            // Ensure ownerTokenReady is true — it may have stayed false if the network
            // failed during the owner-login call (before setOwnerTokenReady fired).
            setOwnerTokenReady(true)
            // Do NOT call fetchAlbum() directly — setOwnerTokenReady triggers a re-render
            // which rebuilds the fetchAlbum closure, and the fetchAlbum effect fires it.
          }}
          className="rounded-xl px-6 py-2.5 font-semibold transition hover:opacity-85"
          style={{ background: '#630826', color: '#FDFAF5' }}
        >
          Retry
        </button>
      </div>
    )
  }

  if (passwordGate) {
    return (
      <PasswordGate
        slug={passwordGate.slug}
        title={passwordGate.title}
        onUnlocked={() => {
          fetchGenRef.current++
          setPasswordGate(null)
          setLoading(true)
          void fetchAlbum()
        }}
      />
    )
  }

  if (revealGate) {
    return (
      <>
        <RevealCountdown
          revealAt={revealGate.revealAt}
          title={revealGate.title}
          onUnlocked={() => {
            // Nothing to sequence: the curtain is rendered by every branch the render can reach,
            // so it stays mounted across the whole swap. (This used to defer the gate by one
            // requestAnimationFrame, which was doubly wrong — rAF runs BEFORE paint, so it never
            // guaranteed the ordering it was written for.)
            setCurtain(true)
            fetchGenRef.current++
            setRevealGate(null)
            setLoading(true)
            void fetchAlbum()
          }}
        />
        {/* Rendered in THIS branch too, or there is nothing on screen to cover the countdown with. */}
        {curtain && <RevealCurtain ready={false} onDone={() => setCurtain(false)} />}
      </>
    )
  }

  if (!album) {
    return (
      <>
        <AlbumSkeleton />
        {curtain && <RevealCurtain ready={false} onDone={() => setCurtain(false)} />}
      </>
    )
  }

  // ─── Main render ─────────────────────────────────────────────────────────────

  const bgIsImage = isImageBackground(album.background_theme)
  const bgStyle = getBackgroundColorStyle(album.background_theme)

  // Resolve the header image (custom upload or a chosen album photo) → AlbumHeader shows it as a
  // hero banner. Falls back to the accent band when neither is set.
  const coverUrl = resolveHeaderImageUrl(album, photos)

  // Bib search narrows the SAME grid rather than opening a separate results view. Filtering is
  // client-side over photos already loaded, so typing is instant and costs no requests. When the
  // album isn't a race album (or the box is empty) this is the untouched photo list.
  // Memoised for IDENTITY: this object sits in visiblePhotos' deps, and a fresh {} every render
  // rebuilt the filtered array during an active bib search — which re-rendered every tile and
  // re-packed the masonry on the product's flagship flow, on race albums, mid-search.
  const bibRange = useMemo(
    () => ({ min: album.bib_min ?? null, max: album.bib_max ?? null }),
    [album.bib_min, album.bib_max])
  // The server's answer for THIS query wins; the local filter covers the moment before it lands
  // and the case where the request failed. bibResult is tagged with the query it answers, so a
  // stale response for an earlier number can never be shown against a newer one.
  // PENDING PHOTOS COME OUT OF THE ALBUM ENTIRELY, and go to their own strip above it.
  //
  // Only an owner ever receives hidden rows (fetchAuthorizedPhotos filters them for everyone
  // else), and mixing them into the grid behind a small badge is what let a real queue build up
  // unnoticed on a live event album — with every photo in it invisible to bib and face search,
  // so a runner searching for one was told there was nothing.
  //
  // Gated on require_approval, because `hidden` carries TWO meanings: "a guest added this and
  // nobody has approved it" and "the owner deliberately hid this one". Without the gate, hiding a
  // photo on purpose would drop it into a review queue that nags to approve it forever. When
  // approval is off there is no queue, and a hidden photo stays where it always was — in the grid
  // with its badge, owner-only. Distinguishing them properly needs a column of its own; until
  // there is one, the album's own setting is the honest signal for which meaning applies.
  // These three feed the grid's identity, so they are memoised together — see visiblePhotos below.
  // Without it an owner with photos awaiting review rebuilt the whole list on every parent render.
  const pendingPhotos = useMemo(
    () => (effectiveIsOwner && album.require_approval ? photos.filter((p) => p.hidden) : EMPTY_PHOTOS),
    [effectiveIsOwner, album.require_approval, photos])
  const publishedPhotos = useMemo(
    () => (pendingPhotos.length > 0 ? photos.filter((p) => !p.hidden) : photos),
    [pendingPhotos, photos])
  const pendingIds = useMemo(
    () => (pendingPhotos.length > 0 ? new Set(pendingPhotos.map((p) => p.id)) : null),
    [pendingPhotos])
  // MEMOISED because this array's IDENTITY is what decides whether the grid re-renders.
  //
  // In the plain case it is `photos` itself and identity holds for free. But with a bib search
  // running, or for an owner whose review queue is non-empty, the .filter() built a fresh array on
  // every parent render — which invalidates both the masonry pack and the tile list's memo, on
  // exactly the two albums where that costs most (a race album mid-search, an event album mid-upload).
  const visiblePhotos = useMemo(() => (
    album.bib_search_enabled && bibDigits
      // The SERVER returns hidden rows to an owner, so a bib search re-admitted the very photos the
      // review strip just took out of the grid — the same photo in both places, the one below
      // reading as already published.
      ? (bibServerAnswered
          ? (pendingIds ? bibServerPhotos.filter((p) => !pendingIds.has(p.id)) : bibServerPhotos)
          : publishedPhotos.filter((p) => bibMatches(p, bibQuery, bibRange)))
      : publishedPhotos
  ), [album.bib_search_enabled, bibDigits, bibServerAnswered, bibServerPhotos, pendingIds,
      publishedPhotos, bibQuery, bibRange])
  // `total` counts hidden rows for an owner (the server does not filter them from the count), and
  // since pending photos left the grid it no longer describes what is on screen: the lightbox
  // read "1 / 10" over seven photos and wrapped at seven.
  const publishedTotal = Math.max(0, total - pendingPhotos.length)
  // Progress figures for the "still reading photos" note — indexing happens in the background
  // after upload, so a guest can arrive before every photo has been read.
  //
  // COUNTED OVER THE WHOLE ALBUM BY THE SERVER, not over the loaded window. Counting locally made
  // the two numbers agree with each other perfectly on a partly-loaded album — "2,000 of 2,000
  // read" while 3,000 photos were still coming — which is the most reassuring possible way to be
  // wrong. The local counts remain as the fallback until the first response lands.
  const totalImageCount = bibStats?.totalImages ?? photos.filter((p) => p.media_type !== 'video').length
  const bibIndexedCount = bibStats?.indexed ?? photos.filter((p) => p.media_type !== 'video' && p.bib_numbers != null).length
  const headerVideo = resolveHeaderVideo(album, photos)

  return (
    <>
      {/* Everything above the curtain is wrapped in ONE fragment so this branch has the same two
          children as the gate branches. React reconciles fragment children by POSITION, and the
          curtain previously sat at index 1 in the gate branches and index 2 here — which is an
          unmount and a remount, not a move. Its timers reset, and if the 5s ceiling had already
          parted the panels, a slow album landing mid-parting snapped them shut over it. */}
      <>
      {/* Fixed background image — lives outside <main> so any stacking context on
          <main> cannot trap it. z-index: -10 paints it behind all page content.
          Body background (#FDFAF5, set in global CSS) shows if the image fails to load. */}
      {bgIsImage && album.background_theme && (
        <div
          className="fixed inset-0 -z-10 pointer-events-none"
          style={{
            backgroundImage: `url("${getBackgroundImageUrl(album.background_theme)}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
          aria-hidden="true"
        />
      )}

      <main
        className="hush-album-page min-h-dvh relative"
        style={{ ...bgStyle, '--album-font': fontStack(album.title_font) } as CSSProperties}
        aria-label={album.title}
      >
        {/* photoCount is `total` — the album's true count from the server. `photos.length` is
            only the loaded WINDOW (500 + 500 per scroll page), and using it here told a visitor
            to a 3,700-photo album that it held "1,500 photos". Rule 18: the window is not the
            album. */}
        <AlbumHeader
          album={album}
          photoCount={total}
          isOwner={effectiveIsOwner}
          onAlbumUpdated={handleAlbumUpdated}
          coverUrl={coverUrl}
          headerVideo={headerVideo}
        />

        {effectiveIsOwner ? (
          <OwnerToolbar
            album={album}
            photos={photos}
            // total, not publishedTotal: this labels "Download all", which really does fetch every
            // row in the album, pending ones included.
            albumPhotoCount={total}
            ownerToken={ownerToken}
            userTier={userTier}
            purchasePending={thanksRequested}
            mediaRadiusMax={Math.max(1, mediaRadiusMax)}
            onAlbumUpdated={handleAlbumUpdated}
            onOpenSlideshow={() => setSlideshowRequestId(id => id + 1)}
            arrangeMode={arrangeMode}
            onToggleArrangeMode={() => setArrangeMode(m => !m)}
            onOpenDesigner={() => { designerOpenRef.current = true; setDesignerOpen(true) }}
          />
        ) : ownerUpgradePending ? (
          // Same-height neutral placeholder while the owner check resolves — no guest-bar flash,
          // no layout shift when the real toolbar lands.
          <div aria-hidden="true" style={{ background: '#F5F0E8', borderBottom: '1px solid #DDD5C5', height: 54 }} />
        ) : (
          <GuestActionsBar
            album={album}
            photos={photos}
            shareUrl={`${SITE_ORIGIN}/${album.custom_slug ?? album.slug}`}
            onOpenSlideshow={() => setSlideshowRequestId(id => id + 1)}
            onOpenFaceFinder={() => setShowFaceFinder(true)}
          />
        )}

        {showFaceFinder && (
          <FaceFinder
            albumSlug={album.custom_slug ?? album.slug}
            photos={photos}
            onClose={() => setShowFaceFinder(false)}
          />
        )}

        {/* Race albums: the bib box goes ABOVE the upload zone. On a race album most visitors are
            runners looking for themselves, not people adding photos — burying the search below a
            large "Add photos" panel made the main reason they came the second thing they saw. */}
        {album.bib_search_enabled && (
          <BibSearchBar
            query={bibQuery}
            onQueryChange={setBibQuery}
            matchCount={visiblePhotos.length}
            indexedCount={bibIndexedCount}
            totalImages={totalImageCount}
            totalMatches={bibServerAnswered ? bibResult.total : null}
            awaitingServer={bibAwaitingServer}
            failed={bibFailed}
            onRetry={() => { setBibFailedQuery(null); setBibRetry((n) => n + 1) }}
            // Only offered when the owner has Face Finder on — otherwise there's nothing to send
            // a runner to and the button would be a lie.
            onTryFaceFinder={album.face_finder_enabled ? () => setShowFaceFinder(true) : undefined}
          />
        )}

        {(album.guest_uploads_enabled || effectiveIsOwner) && (
          <UploadZone album={album} onPhotosUploaded={handlePhotosUploaded} />
        )}

        {/* The renewal email's landing spot. Rendered from the URL param, NOT from owner
            status: the email is opened on devices where no owner cookie or token exists, and the
            server is the one that decides who may pay. The owner toolbar's own package section
            covers the on-device owner, so this skips them to avoid two surfaces at once. */}
        {renewRequested && !effectiveIsOwner && album && <RenewPackagePrompt album={album} />}

        {/* Just paid. The Polar redirect drops the #owner= fragment, so the buyer lands in the
            ordinary guest view of their own album — with, until this existed, no sign anywhere
            that the payment had happened and the same two buy buttons waiting if they went back
            for their owner link. */}
        {thanksRequested && album && (
          <PackageThanksBanner
            album={album}
            onApplied={(fresh) => setAlbum(prev => prev ? { ...prev, ...fresh } : prev)}
          />
        )}

        {effectiveIsOwner && pendingPhotos.length > 0 && (
          <PendingReview
            slug={album.custom_slug ?? album.slug}
            photos={pendingPhotos}
            onAccepted={(ids) => { for (const id of ids) handlePhotoUpdated(id, { hidden: false }) }}
            onDeclined={(ids) => { for (const id of ids) handlePhotoDeleted(id) }}
          />
        )}

        <div className="hush-container pb-6">
          <PhotoGrid
            // The unfiltered count: bib search narrows `visiblePhotos`, and without this the grid
            // would collapse to one wide column whenever a search matched a single photo.
            // publishedTotal, not total: an owner's `total` includes photos awaiting review, which
            // the grid no longer shows — the lightbox counter read "1 / 10" over seven photos.
            albumPhotoCount={publishedTotal}
            album={album}
            photos={visiblePhotos}
            filtered={bibFilterActive}
            isOwner={effectiveIsOwner}
            slug={album.slug}
            forceGlobalRadius={forceGlobalRadius}
            onRadiusMaxChange={setMediaRadiusMax}
            onPhotoDeleted={handlePhotoDeleted}
            onPhotoUpdated={handlePhotoUpdated}
            onPhotosReordered={handlePhotosReordered}
            slideshowRequestId={slideshowRequestId}
            arrangeMode={arrangeMode}
            coverPhotoId={album.cover_photo_id}
            onCoverSet={(photoId) => handleAlbumUpdated({ cover_photo_id: photoId })}
          />
        </div>

        {!bibFilterActive && total > ALBUM_FIRST_WINDOW && total > photos.length && (
          <div ref={loadMoreSentinelRef} className="text-center py-6">
            <button
              type="button"
              onClick={() => { void loadMore() }}
              disabled={loadingMore}
              className="hush-press"
              style={{ fontSize: 14, fontWeight: 600, color: '#FDFAF5', background: '#630826', border: 'none', borderRadius: 999, padding: '10px 24px', cursor: loadingMore ? 'default' : 'pointer', opacity: loadingMore ? 0.6 : 1 }}
            >
              {loadingMore ? 'Loading…' : `Load more · ${photos.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`}
            </button>
          </div>
        )}
        {ownerSavePromptOpen && album && createPortal(
          <>
            <div className="hush-share-backdrop" onClick={dismissOwnerPrompt} />
            <div style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 210, width: 'min(92vw, 440px)' }}>
              <SignInPrompt
                title="Save this album to your account"
                subtitle="One tap with Google, so you never lose it."
                next={`/${slug}?owner_saved=1`}
                storageKey={`hushare.savePrompt.${album.id}`}
                onDismiss={dismissOwnerPrompt}
              />
            </div>
          </>,
          document.body,
        )}

        {effectiveIsOwner && designerOpen && (
          <AlbumDesigner album={album} photos={photos} onAlbumUpdated={handleAlbumUpdated} onClose={() => { designerOpenRef.current = false; setDesignerOpen(false) }} />
        )}
      </main>

      {/* LAST child in every branch, deliberately.
          React reconciles by position, so when this sat first here and second in the countdown and
          skeleton branches, loading the album moved it from index 1 to index 0 — which is an unmount
          and a remount, not a move. Its state reset and the whole curtain replayed from closed,
          which is the double-play that made the fix look like it had done nothing. Same slot
          everywhere means one instance that survives all three renders. */}
      </>
      {curtain && <RevealCurtain ready={!!album && !loading} onDone={() => setCurtain(false)} />}
    </>
  )
}
