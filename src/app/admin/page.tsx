import { r2BucketName } from '@/lib/server/environment'
import { notFound } from 'next/navigation'
import AdminLiveStats from '@/components/AdminLiveStats'
import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'
import AdminRefreshButton from '@/components/AdminRefreshButton'
import AdminErrorTabs, { type ErrorRow } from '@/components/AdminErrorTabs'
import AdminTestAlertButton from '@/components/AdminTestAlertButton'
import AdminDeleteAlbumButton from '@/components/AdminDeleteAlbumButton'
import AdminSyncPolarButton from '@/components/AdminSyncPolarButton'
import AdminPublishStatement from '@/components/AdminPublishStatement'
import AdminLiveUsers from '@/components/AdminLiveUsers'
import AdminStorageAudit from '@/components/AdminStorageAudit'
import AdminGrowthChart from '@/components/AdminGrowthChart'
import AdminWeekdayBars from '@/components/AdminWeekdayBars'
import AdminBreakdown from '@/components/AdminBreakdown'
import AdminClockHeatmap from '@/components/AdminClockHeatmap'
import AdminFunnel from '@/components/AdminFunnel'
import AdminUsers, { type UserRow, type Cohort } from '@/components/AdminUsers'
import { isSubActive } from '@/lib/subscriptions'
import { checkIntroDiscounts, checkPlanProducts, checkPackageProducts } from '@/lib/polar'
import { discountBanner, discountRowsToShow } from '@/lib/discount-health'
import { attachAlbumOwners } from '@/lib/server/error-attribution'
import { albumCountLimitForTier, albumMediaCapForTier } from '@/lib/media'
import { streamQuotaLevel, streamUnitsNeeded } from '@/lib/stream-quota'
import AdminAreaChartLazy from '@/components/AdminAreaChartLazy'
import { getTrafficAnalytics } from '@/lib/cf-analytics'
import AdminSupportLookup from '@/components/AdminSupportLookup'

// Live data, never cached, never indexed. Access is gated to ADMIN_EMAILS below.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } }

const INK = '#2A211C'
// Where the owner is. Weekday and day-of-week figures are only meaningful in a real timezone, and
// UTC is not the one anybody here lives in — at UTC+4 a UTC weekday files the first four hours of
// every local day under the day before, which is where an event running past midnight lands.
const OWNER_TZ = 'Asia/Yerevan'

const BRAND = '#630826'
const MUTED = '#8A7A66'
const CARD = '#FFFFFF'
const BORDER = '#E4DAC9'

const EVENT_LABELS: Record<string, string> = {
  album_viewed: 'Album views',
  album_created: 'Albums created',
  media_uploaded: 'Uploads',
  media_downloaded: 'Downloads',
  media_deleted: 'Deletes',
  face_search_run: 'Face searches',
  checkout_started: 'Checkouts',
  subscription_active: 'Subs activated',
  subscription_canceled: 'Subs canceled',
  album_retired: 'Albums retired',
  support_submitted: 'Support forms',
  report_submitted: 'Reports',
  support_chat: 'Support chats',
}

type AlbumRow = {
  id: string
  slug: string
  custom_slug: string | null
  title: string
  user_id: string | null
  created_at: string
  retired_at: string | null
}

async function getStreamUsage(): Promise<{ minutes: number; limit: number; videos: number } | null> {
  const acc = process.env.CLOUDFLARE_ACCOUNT_ID
  const tok = process.env.CLOUDFLARE_STREAM_TOKEN
  if (!acc || !tok) return null
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/stream/storage-usage`, {
      headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store',
    })
    const j = await r.json() as { result?: { totalStorageMinutes?: number; totalStorageMinutesLimit?: number; videoCount?: number } }
    if (!j.result) return null
    return {
      minutes: Math.round(j.result.totalStorageMinutes ?? 0),
      limit: j.result.totalStorageMinutesLimit ?? 0,
      videos: j.result.videoCount ?? 0,
    }
  } catch { return null }
}


// R2 holds every photo, and until now nothing on this page said how much was in there or what it
// costs. Photos are the thing there are millions of, so before a 3000-photo race day this is the
// number worth knowing. There is no size column on `photos` — sizes were never recorded — so this
// asks R2 itself, which is also the only source that counts thumbnails, posters and mirrors.
//
// Needs a token with R2 Read; CLOUDFLARE_STREAM_TOKEN is scoped to Stream and returns 403. Falls
// back to null rather than throwing, exactly like getStreamUsage, so a missing token degrades the
// card instead of the page.
async function getR2Usage(): Promise<{ gb: number; objects: number; usd: number } | null> {
  const acc = process.env.CLOUDFLARE_ACCOUNT_ID
  const tok = process.env.CLOUDFLARE_R2_TOKEN
  const bucket = r2BucketName()
  if (!acc || !tok) return null
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/r2/buckets/${bucket}/usage`, {
      headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store',
    })
    const j = await r.json() as { result?: { payloadSize?: string | number; objectCount?: string | number } }
    if (!j.result) return null
    const bytes = Number(j.result.payloadSize ?? 0)
    const gb = bytes / 1e9
    // R2 standard storage is $0.015 per GB-month and charges nothing for egress, which is the whole
    // reason photos are cheap here. Rounded up to a cent so it never reads as free when it is not.
    return { gb, objects: Number(j.result.objectCount ?? 0), usd: Math.ceil(gb * 0.015 * 100) / 100 }
  } catch { return null }
}

function fmt(ts: string): string {
  // Stable, locale-independent formatting (avoids hydration drift): YYYY-MM-DD HH:MM
  return ts.replace('T', ' ').slice(0, 16)
}

export default async function AdminPage() {
  // ── Gate: must be logged in AND on the ADMIN_EMAILS allowlist. 404 (not redirect) so the
  // page's very existence stays hidden from anyone who isn't an admin.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!isAccountAdmin(user)) notFound()

  const admin = createAdminClient()

  const [
    albumsActive, albumsRetired, imgCount, vidCount, subsCount,
    recentAlbumsRes, subsRes, streamUsage, r2Usage, discountHealth, planHealth, usersRes, errors24Res, recentErrorsRes,
    clearedMsgsRes, backupRes,
  ] = await Promise.all([
    admin.from('albums').select('id', { count: 'exact', head: true }).is('retired_at', null),
    admin.from('albums').select('id', { count: 'exact', head: true }).not('retired_at', 'is', null),
    admin.from('photos').select('id', { count: 'exact', head: true }).eq('media_type', 'image'),
    admin.from('photos').select('id', { count: 'exact', head: true }).eq('media_type', 'video'),
    // ACTIVE only, matching /api/admin/stats. They disagreed, so the first live poll 20s after load
    // dropped the card from "all rows" to "active" and rendered the difference as a red delta that
    // had not happened.
    admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    admin.from('albums').select('id, slug, custom_slug, title, user_id, created_at, retired_at')
      .order('created_at', { ascending: false }).limit(300).returns<AlbumRow[]>(),
    admin.from('subscriptions').select('user_id, tier, status, current_period_end, polar_product_id, created_at')
      .order('created_at', { ascending: false }).limit(200),
    getStreamUsage(),
    getR2Usage(),
    checkIntroDiscounts(),
    // Subscriptions AND one-time packages, merged: the banner below asks one question — does
    // Polar charge what we sell it as — and the answer has to cover everything with a price.
    Promise.all([checkPlanProducts(), checkPackageProducts()]).then(([a, b]) => [...a, ...b]),
    // 500, not 200. This one result feeds the signups list, the growth counts and the email lookup
    // for the albums table, so the page cap is the real ceiling on all three. At 33 users there is
    // plenty of head-room; past 500 this needs a paged query rather than a bigger number.
    admin.auth.admin.listUsers({ page: 1, perPage: 500 }),
    // Deliberately NOT windowed to 24h. It used to be, while the tab it points at listed everything
    // unresolved — so the card said 0 and the tab said 4, both labelled "errors". One definition:
    // an error is open until it is cleared.
    admin.from('error_events').select('id', { count: 'exact', head: true }).eq('level', 'error').is('resolved_at', null),
    admin.from('error_events').select('created_at, level, source, message, album_id, ua, context')
      .is('resolved_at', null)
      .order('created_at', { ascending: false }).limit(200)
      .returns<ErrorRow[]>(),
    // Every message that has EVER been cleared. Membership separates "this came back after we
    // thought it was fixed" from "nobody has seen this before" — the one distinction the table
    // could not make, and the one worth acting on.
    //
    // Fetched as a flat column and de-duplicated below rather than aggregated in SQL, because
    // PostgREST cannot express GROUP BY and the alternative (an .in() filter carrying 200 message
    // strings) builds a URL long enough to be truncated. At a few hundred rows this is nothing; if
    // error_events ever grows past the limit it should become a database view, and the cap means
    // the failure mode is a missing mark rather than a slow admin page.
    admin.from('error_events').select('message').not('resolved_at', 'is', null).limit(5000),
    // When the database was last copied off this infrastructure. Written by scripts/backup-upload
    // only after an upload succeeds, so its ABSENCE is the signal — see the backup line in
    // AdminLiveStats.
    admin.from('system_state').select('updated_at').eq('key', 'last_backup_at').maybeSingle(),
  ])

  const lastBackupAt = (backupRes.data as { updated_at?: string } | null)?.updated_at ?? null
  const backupAgeHours = lastBackupAt
    ? Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / 3600e3)
    : null
  // 36 hours rather than 24: the job runs at 03:15 UTC, so this means a night was missed outright
  // rather than a run being a few hours late.
  const backupFreshness = { lastBackupAt, backupAgeHours, backupStale: backupAgeHours === null || backupAgeHours > 36 }

  const recentAlbums = recentAlbumsRes.data ?? []
  const subs = subsRes.data ?? []
  const allUsers = usersRes.data?.users ?? []
  const recentErrors = recentErrorsRes.data ?? []

  // id → email map for owners + recent signups (one listUsers call, no N+1)
  const emailById = new Map<string, string>()
  for (const u of allUsers) if (u.id) emailById.set(u.id, u.email ?? '(no email)')

  // WHOSE album an error came from, so the owner can be helped rather than just counted.
  // Shared with the live-stats poll that replaces these rows every few seconds — enriching only
  // here would fill the column on load and empty it moments later (lib/server/error-attribution).
  const errorsWithOwner = await attachAlbumOwners(admin, recentErrors, emailById)

  // Per-album media counts for the recent list, aggregated in JS. PostgREST caps a single
  // response at max_rows (default 1000), and the recent albums together hold far MORE than 1000
  // photo rows — so an unbounded select silently truncates and big albums show wildly-low counts.
  // Paginate with an explicit order (stable range windows) until a short page ends the loop.
  const albumIds = recentAlbums.map(a => a.id)
  const countsByAlbum = new Map<string, { img: number; vid: number }>()
  if (albumIds.length) {
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data: media, error } = await admin
        .from('photos')
        .select('album_id, media_type')
        .in('album_id', albumIds)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error || !media || media.length === 0) break
      for (const m of media) {
        const c = countsByAlbum.get(m.album_id) ?? { img: 0, vid: 0 }
        if (m.media_type === 'video') c.vid++; else c.img++
        countsByAlbum.set(m.album_id, c)
      }
      if (media.length < PAGE) break
    }
  }

  // Every registered user, newest first — not the newest 15.
  //
  // The cap made sense when the table grew the page; it now scrolls inside its own card, so the
  // only thing the slice achieved was hiding the other users behind a scrollbar that had nothing
  // left to scroll to. Bounded by the listUsers page below rather than by an arbitrary number.
  // ── Growth: new users/albums/uploads over the last 7 and 30 days, plus 7-day active albums.
  // Cheap head-counts; user growth is derived from the already-fetched listUsers result (no extra
  // auth call). Note: newUsers counts are bounded by the 200-user listUsers page — fine at current
  // scale; revisit with a dedicated created_at query once registrations exceed a few hundred.
  // One clock read for every window on this page. Three separate Date.now() calls could, in
  // principle, straddle a midnight and give windows that disagree with each other by a day — and
  // each one is separately flagged as impure in a render path.
  const nowMs = Date.now()
  const DAY_MS = 24 * 60 * 60 * 1000
  const weekAgo = new Date(nowMs - 7 * DAY_MS).toISOString()
  const monthAgo = new Date(nowMs - 30 * DAY_MS).toISOString()
  const [newAlbums7d, newAlbums30d, newUploads7d, newUploads30d, activeAlbums7d] = await Promise.all([
    admin.from('albums').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    admin.from('albums').select('id', { count: 'exact', head: true }).gte('created_at', monthAgo),
    admin.from('photos').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    admin.from('photos').select('id', { count: 'exact', head: true }).gte('created_at', monthAgo),
    admin.from('albums').select('id', { count: 'exact', head: true }).is('retired_at', null).gte('last_activity_at', weekAgo),
  ])
  const newUsers7d = allUsers.filter((u) => (u.created_at ?? '') >= weekAgo).length
  const newUsers30d = allUsers.filter((u) => (u.created_at ?? '') >= monthAgo).length

  // ── Users: who they are and whether they are still here ──
  //
  // The two functions aggregate DB-side so this page never pulls every album and photo row in to
  // count them. Tier is joined on HERE rather than in SQL: whether a subscription counts as active
  // is a real rule with a grace window and several statuses, and writing it a second time in
  // Postgres would leave two versions of it to drift apart quietly. isSubActive is that one rule.
  const [{ data: userRowsRaw }, { data: cohortRaw }] = await Promise.all([
    admin.rpc('admin_user_overview', { p_limit: 300 }),
    admin.rpc('admin_user_cohorts', { p_months: 6 }),
  ])

  // WHO IS ACTUALLY PAYING, AND WHO IS US.
  //
  // Admin accounts resolve to Max in code (see computeUserTier) and some also carry a comped row,
  // so both sat in the Subscriptions table looking exactly like revenue. A dashboard that counts
  // its own operators as customers is worse than no dashboard: every number built on it is wrong in
  // the flattering direction.
  //
  // Two signals, because either alone misses a case: a comp row is by definition not revenue, and
  // an admin is not a customer even without one.
  const isHouseAccount = (userId: string | null | undefined, productId: string | null | undefined): boolean => {
    if (String(productId ?? '').startsWith('comp-')) return true
    const email = userId ? emailById.get(userId) : null
    return isAccountAdmin({ email })
  }
  // The section lists PEOPLE, not subscription rows: an admin's Max comes from code (see
  // computeUserTier), so the owner's own account has no row at all and a row-based section showed
  // "None." while alinagnuni3's comp row sat in Subscriptions looking like revenue — because the
  // query above didn't even select polar_product_id, and a filter on an unselected column is a
  // filter on undefined. Both halves of that failure were silent.
  const houseSubs = subs.filter((s) => isHouseAccount(
    (s as { user_id?: string | null }).user_id,
    (s as { polar_product_id?: string | null }).polar_product_id,
  ))
  const payingSubs = subs.filter((s) => !houseSubs.includes(s))

  const houseRows: { email: string; tier: string; why: string }[] = []
  {
    const seen = new Set<string>()
    for (const u of allUsers) {
      if (!isAccountAdmin(u)) continue
      const email = u.email ?? '(no email)'
      seen.add(email)
      const hasComp = houseSubs.some((x) => (x as { user_id?: string | null }).user_id === u.id)
      houseRows.push({ email, tier: 'studio', why: hasComp ? 'admin · comped' : 'admin' })
    }
    for (const x of houseSubs) {
      const uid = (x as { user_id?: string | null }).user_id
      const email = uid ? (emailById.get(uid) ?? '(user)') : '—'
      if (seen.has(email)) continue
      houseRows.push({ email, tier: String((x as { tier?: string }).tier ?? ''), why: 'comped' })
    }
  }

  const tierByUser = new Map<string, 'pro' | 'studio'>()
  for (const sub of subs) {
    const row = sub as { user_id?: string | null; tier?: string; status?: string; current_period_end?: string | null }
    if (!row.user_id || !row.tier) continue
    if (!isSubActive({ status: String(row.status ?? ''), current_period_end: row.current_period_end ?? null })) continue
    // A user can hold several rows; the higher tier wins, exactly as getActiveSubscription decides.
    if (row.tier === 'studio') tierByUser.set(row.user_id, 'studio')
    else if (!tierByUser.has(row.user_id)) tierByUser.set(row.user_id, 'pro')
  }

  const userRows: UserRow[] = ((userRowsRaw ?? []) as Record<string, unknown>[]).map((r) => {
    const id = String(r.user_id ?? '')
    const tier = tierByUser.get(id) ?? 'free'
    return {
      id,
      email: String(r.email ?? ''),
      joined: r.created_at ? fmt(String(r.created_at)) : '—',
      lastSignIn: r.last_sign_in_at ? String(r.last_sign_in_at) : null,
      lastActive: r.last_active ? String(r.last_active) : null,
      albums: Number(r.albums ?? 0),
      media: Number(r.media ?? 0),
      tier,
      // The caps the SERVER enforces, so "at album limit" means the same thing here as it does to
      // the person who just hit it.
      albumCap: albumCountLimitForTier(tier),
      mediaCap: albumMediaCapForTier(tier),
    }
  })

  const cohorts: Cohort[] = ((cohortRaw ?? []) as Record<string, unknown>[]).map((r) => ({
    month: String(r.month ?? '').slice(0, 7),
    signups: Number(r.signups ?? 0),
    stillActive: Number(r.still_active ?? 0),
  })).filter((c) => c.month)

  const growthCards: { label: string; value: string; hint?: string }[] = [
    { label: 'New users', value: String(newUsers7d), hint: `${newUsers30d} in 30d` },
    { label: 'New albums', value: String(newAlbums7d.count ?? 0), hint: `${newAlbums30d.count ?? 0} in 30d` },
    { label: 'New uploads', value: String(newUploads7d.count ?? 0), hint: `${newUploads30d.count ?? 0} in 30d` },
    { label: 'Active albums', value: String(activeAlbums7d.count ?? 0), hint: 'touched in 7d' },
  ]

  // ── Which DAYS OF THE WEEK are busy, over twelve weeks.
  //
  // Twelve, not the two the chart above uses: fourteen days gives two samples per weekday, so a
  // single wedding would make Saturday look like a pattern.
  //
  // Bucketed in OWNER_TZ rather than UTC. The owner is at UTC+4, so a UTC weekday puts the first
  // four hours of every local day on the day before — an event running past midnight is filed under
  // the wrong day, and that is exactly the signal this chart exists to show. Against live data the
  // difference is not academic: Monday uploads move by 300 between the two.
  const WEEKDAY_DAYS = 84
  // These two, the traffic analytics, and the user overview are all INDEPENDENT, and they were
  // being awaited one after another: four sequential round trips, each a few hundred milliseconds,
  // before the page could render a single pixel. That is what put the root loading spinner on screen
  // for long enough to look stuck. Issued together they cost the slowest one rather than the sum.
  const [{ data: growthRaw }, { data: weekdayRaw }, analytics] = await Promise.all([
    admin.rpc('admin_growth_series', { p_days: 14 }),
    admin.rpc('admin_weekday_series', { p_days: WEEKDAY_DAYS, p_tz: OWNER_TZ }),
    getTrafficAnalytics(),
  ])

  // ── Growth charts: daily new albums/uploads (aggregated DB-side) + signups (from the users page).
  // Issued with the weekday series below — see the note there.
  const series = (growthRaw ?? []) as { day: string; albums: number | string; uploads: number | string }[]
  const signupByDay = new Map<string, number>()
  for (const u of allUsers) {
    const d = (u.created_at ?? '').slice(0, 10)
    if (d) signupByDay.set(d, (signupByDay.get(d) ?? 0) + 1)
  }
  // 0 = Sunday from Postgres; the week reads better starting on Monday.
  const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0]
  const WEEKDAY_NAMES: Record<number, string> = {
    0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday',
  }
  const weekdayRows = (weekdayRaw ?? []) as { dow: number; albums: number | string; uploads: number | string }[]
  const byDow = new Map(weekdayRows.map((r) => [Number(r.dow), r]))

  // Signups are counted here rather than in SQL because the users list is already in memory — but
  // in the SAME timezone as the query above, or the three charts would disagree with each other.
  const signupCutoff = nowMs - WEEKDAY_DAYS * DAY_MS
  const signupDow = new Map<number, number>()
  for (const u of allUsers) {
    const t = u.created_at ? Date.parse(u.created_at) : NaN
    if (!Number.isFinite(t) || t < signupCutoff) continue
    // 'en-US' + an explicit timeZone: the weekday must not depend on where this code happens to run.
    const name = new Date(t).toLocaleDateString('en-US', { weekday: 'long', timeZone: OWNER_TZ })
    const dow = Number(Object.keys(WEEKDAY_NAMES).find((k) => WEEKDAY_NAMES[Number(k)] === name) ?? -1)
    if (dow >= 0) signupDow.set(dow, (signupDow.get(dow) ?? 0) + 1)
  }
  const weekdaySignups = MONDAY_FIRST.map((d) => ({ name: WEEKDAY_NAMES[d], value: signupDow.get(d) ?? 0 }))
  const weekdayAlbums = MONDAY_FIRST.map((d) => ({ name: WEEKDAY_NAMES[d], value: Number(byDow.get(d)?.albums ?? 0) }))
  const weekdayUploads = MONDAY_FIRST.map((d) => ({ name: WEEKDAY_NAMES[d], value: Number(byDow.get(d)?.uploads ?? 0) }))

  const albumsPts = series.map((s) => ({ day: s.day, value: Number(s.albums) }))
  const uploadsPts = series.map((s) => ({ day: s.day, value: Number(s.uploads) }))
  const signupsPts = series.map((s) => ({ day: s.day, value: signupByDay.get(s.day) ?? 0 }))

  // ── Cloudflare analytics: worker perf (GraphQL) + product events (Analytics Engine). All optional —
  // each is null when the token/query is unavailable, so the section just shows what it can.
  // analytics is fetched above, alongside the growth series.
  const analyticsOn = analytics.configured
  const workerMetrics = analytics.workerMetrics
  const eventTotals = analytics.eventTotals
  const topAlbumsRaw = analytics.topAlbums
  const viewsPerDay = analytics.viewsPerDay
  // Resolve top-album IDs → titles/slugs for a clickable table.
  const topAlbumIds = (topAlbumsRaw ?? []).map((a) => a.albumId)
  const topAlbumMeta = new Map<string, { slug: string; title: string }>()
  if (topAlbumIds.length) {
    const { data: metaRows } = await admin.from('albums').select('id, slug, custom_slug, title').in('id', topAlbumIds)
    for (const a of (metaRows ?? []) as { id: string; slug: string; custom_slug: string | null; title: string }[]) {
      topAlbumMeta.set(a.id, { slug: a.custom_slug ?? a.slug, title: a.title })
    }
  }
  const trafficCards: { label: string; value: string; hint?: string }[] = workerMetrics ? [
    { label: 'Requests', value: workerMetrics.requests.toLocaleString('en-US'), hint: 'last 24h' },
    { label: 'Errors', value: workerMetrics.errors.toLocaleString('en-US'), hint: workerMetrics.requests > 0 ? `${((workerMetrics.errors / workerMetrics.requests) * 100).toFixed(2)}%` : 'last 24h' },
    { label: 'CPU p50', value: `${workerMetrics.cpuP50} µs`, hint: 'per request' },
    { label: 'CPU p99', value: `${workerMetrics.cpuP99} µs`, hint: 'per request' },
  ] : []

  // The counts that change minute to minute are handed to a client component so it can refresh them
  // and show what has moved since the last visit. Storage figures stay here: they are calls out to
  // Cloudflare, they change slowly, and polling them would spend a rate limit to watch an hourly
  // number.
  const liveInitial = {
    albums: albumsActive.count ?? 0,
    photos: imgCount.count ?? 0,
    videos: vidCount.count ?? 0,
    // listUsers is capped at perPage: 200, so allUsers.length silently plateaus there while the
    // stats route returns the true total — another phantom jump on the first poll. The old card
    // carried a "200+" suffix admitting the cap; the live one has no way to.
    users: (usersRes.data as { total?: number } | null)?.total ?? allUsers.length,
    // Paying customers only. subsCount counts every active row, which includes comps and admins —
    // see isHouseAccount. Counting ourselves as subscribers made the one number on this page that
    // is supposed to mean revenue mean something else.
    subscriptions: Math.max(0, (subsCount.count ?? 0) - houseSubs.length),
    openErrors: errors24Res.count ?? 0,
    // Included in the FIRST paint, not left to the poll 20 seconds later. This is the one line on
    // the page that says whether the database has a copy anywhere else, and a version of it that
    // appears late is a version somebody closes the tab before seeing.
    ...backupFreshness,
  }

  const cards: { label: string; value: string; hint?: string }[] = [
    // Stream storage is BOUGHT in 1,000-minute units at $5/month, and running out does not cost
    // more — it makes every video upload fail everywhere. So this card says how close the ceiling
    // is and what to do, rather than two numbers whose relationship nobody remembers.
    streamUsage
      ? {
          label: 'Stream video',
          value: `${streamUsage.minutes} / ${streamUsage.limit} min`,
          hint: streamQuotaLevel(streamUsage.minutes, streamUsage.limit) === 'ok'
            ? `${streamUsage.videos} videos stored`
            : `${streamUsage.videos} stored — buy ${streamUnitsNeeded(streamUsage.minutes)} x 1,000 min ($${streamUnitsNeeded(streamUsage.minutes) * 5}/mo) before uploads start failing`,
        }
      : { label: 'Stream video', value: 'n/a', hint: 'CF token missing' },
    r2Usage
      ? { label: 'Photo storage', value: `${r2Usage.gb.toFixed(2)} GB`, hint: `${r2Usage.objects.toLocaleString('en-US')} files · ~$${r2Usage.usd.toFixed(2)}/mo` }
      : { label: 'Photo storage', value: 'n/a', hint: 'add CLOUDFLARE_R2_TOKEN' },
    { label: 'Retired albums', value: String(albumsRetired.count ?? 0), hint: 'not counted above' },
  ]

  // Long lists scroll INSIDE their card rather than growing the page. The album table also used to
  // fetch only the newest 40 rows, so anything older was not there to scroll to — it looked like a
  // display bug and was a data one. Raising the limits and capping the height is the combination
  // that actually lets you reach an old album: more rows, and somewhere to put them.
  const scrollBox: React.CSSProperties = {
    overflowX: 'auto',
    overflowY: 'auto',
    maxHeight: 460,
    background: CARD,
    border: `1px solid ${BORDER}`,
    borderRadius: 12,
  }

  // Sticky, so scrolling a long list does not leave you guessing which column is which.
  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: MUTED, fontWeight: 600, borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: CARD, zIndex: 1 }
  const td: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: INK, borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap' }

  return (
    // overflowX hidden is the backstop, not the fix: every grid below clamps its own floor with
    // min(), and the wide tables scroll inside their own box. This stops one future card with a
    // fixed width from sliding the entire admin page sideways on a phone, which is a failure you
    // only notice by opening it on one.
    <main style={{ minHeight: '100vh', background: '#FDFAF5', padding: 'clamp(16px, 4vw, 28px) clamp(12px, 3.5vw, 20px)', fontFamily: 'var(--font-sans)', overflowX: 'hidden' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        {/* Logo → home */}
        <Link href="/" aria-label="Go to Hushare home" style={{ display: 'inline-block', marginBottom: 18 }}>
          <Image src="/logo/logo-dark-transparent.png" alt="Hushare" width={618} height={146} priority style={{ width: 'auto', height: 32 }} />
        </Link>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: BRAND, fontFamily: 'var(--font-serif)' }}>Hushare Admin</h1>
          <div style={{ display: 'flex', gap: 14, fontSize: 13, alignItems: 'center' }}>
            {/* Real tab reload (client) — re-runs the dynamic page for fresh data. */}
            <AdminRefreshButton />
            <Link href="/account" style={{ color: MUTED }}>Account</Link>
          </div>
        </div>
        <div style={{ marginBottom: 22 }} />

        {/* Real-time active users — self-updating (polls every 5s) */}
        {/* Sticky jump-nav so every section is one click away */}
        <nav style={{ position: 'sticky', top: 0, zIndex: 30, background: '#FDFAF5', borderBottom: `1px solid ${BORDER}`, padding: '10px 0', marginBottom: 22, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(([['support', 'Support'], ['live', 'Live'], ['overview', 'Overview'], ['growth', 'Growth'], ['traffic', 'Traffic'], ['ops', 'Ops'], ['errors', 'Errors'], ['storage', 'Storage'], ['albums', 'Albums'], ['users', 'Users']]) as [string, string][]).map(([id, label]) => (
            <a key={id} href={`#${id}`} style={{ fontSize: 12.5, fontWeight: 600, color: BRAND, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 999, padding: '5px 13px', textDecoration: 'none' }}>{label}</a>
          ))}
        </nav>
        {/* Support — look up a user or album by email/link and act on it */}
        <h2 id="support" style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 10px', scrollMarginTop: 64 }}>Support lookup</h2>
        <AdminSupportLookup />

        <h2 id="live" style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 10px', scrollMarginTop: 64 }}>Live now</h2>
        <AdminLiveUsers />

        {/* Overview — headline totals */}
        <h2 id="overview" style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '20px 0 10px', scrollMarginTop: 64 }}>Overview</h2>
        <AdminLiveStats initial={liveInitial} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 12, marginBottom: 28 }}>
          {cards.map((c) => (
            <div key={c.label} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: INK }}>{c.value}</div>
              {c.hint && <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>{c.hint}</div>}
            </div>
          ))}
        </div>

        {/* Growth — new activity over the last 7 days (30-day total shown in gray) */}
        <h2 id="growth" style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 10px', scrollMarginTop: 64 }}>
          Growth <span style={{ fontSize: 12, fontWeight: 400, color: MUTED }}>· last 7 days (30-day total in gray)</span>
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 12, marginBottom: 28 }}>
          {growthCards.map((c) => (
            <div key={c.label} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: INK }}>{c.value}</div>
              {c.hint && <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>{c.hint}</div>}
            </div>
          ))}
        </div>

        {/* Growth charts — daily trend over the last 14 days. Area charts (Recharts, code-split
            via AdminAreaChartLazy so no guest ever downloads the library). Hover anywhere on a
            chart: the day and value appear in that chart's own header rather than in a floating
            card, which at 120px tall would cover most of the data it is describing.
            Album views below deliberately keeps the bar chart — it is a different kind of number
            (traffic, not creation) and reads better as discrete daily columns. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: 12, marginBottom: 28 }}>
          <AdminAreaChartLazy label="Signups / day" points={signupsPts} color="#1F5136" unit="users" />
          <AdminAreaChartLazy label="New albums / day" points={albumsPts} color={BRAND} unit="albums" />
          <AdminAreaChartLazy label="Uploads / day" points={uploadsPts} color="#B4531F" unit="items" />
        </div>

        <h2 id="people" style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '20px 0 4px', scrollMarginTop: 64 }}>
          Who is visiting
        </h2>
        <p style={{ fontSize: 11.5, color: '#8A7A66', margin: '0 0 10px' }}>
          Last 30 days of album views. Aggregate only — no visitor is identified or followed between
          visits; every figure describes a group.
        </p>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', marginBottom: 12 }}>
          <AdminBreakdown title="Countries" rows={analytics.countries} color="#1F5136" />
          <AdminBreakdown title="Cities" rows={analytics.cities} color="#21458c" />
          <AdminBreakdown title="How they arrived" rows={analytics.referrers} color={BRAND} empty="no referrer data yet" />
          <AdminBreakdown title="Device" rows={analytics.devices} color="#B4531F" />
        </div>
        <div style={{ marginBottom: 12 }}>
          <AdminClockHeatmap points={analytics.clock} color={BRAND} />
        </div>

        <h2 id="friction" style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '20px 0 4px', scrollMarginTop: 64 }}>
          What is hard for them
        </h2>
        <p style={{ fontSize: 11.5, color: '#8A7A66', margin: '0 0 10px' }}>
          Errors say what BROKE. These say what was hard — a guest tapping the same button four times
          because nothing seems to happen never produces an error, they just leave.
        </p>
        <div style={{ marginBottom: 12 }}>
          <AdminFunnel funnel={analytics.funnel} engagement={analytics.engagement} throughput={analytics.throughput} color={BRAND} />
        </div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', marginBottom: 12 }}>
          <AdminBreakdown
            title="Repeated taps on the same spot"
            rows={analytics.friction}
            color="#9B2C2C"
            empty="nobody has hammered anything — good"
          />
        </div>

        <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '20px 0 4px' }}>
          Busiest days of the week
        </h2>
        <p style={{ fontSize: 11.5, color: '#8A7A66', margin: '0 0 10px' }}>
          Last {WEEKDAY_DAYS} days, counted in {OWNER_TZ.replace('_', ' ')} local time.
        </p>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))' }}>
          <AdminWeekdayBars label="Signups" days={weekdaySignups} color="#1F5136" unit="users" />
          <AdminWeekdayBars label="New albums" days={weekdayAlbums} color={BRAND} unit="albums" />
          <AdminWeekdayBars label="Uploads" days={weekdayUploads} color="#B4531F" unit="items" />
        </div>

        {/* Traffic & performance — Cloudflare worker metrics + product events */}
        <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 10px' }}>
          Traffic &amp; performance <span style={{ fontSize: 12, fontWeight: 400, color: MUTED }}>· Cloudflare · worker 24h · events 7d</span>
        </h2>
        <span id="traffic" style={{ display: 'block', height: 0, scrollMarginTop: 64 }} aria-hidden="true" />
        {!analyticsOn ? (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px', marginBottom: 28, fontSize: 13, color: MUTED }}>
            Add a <code>CLOUDFLARE_ANALYTICS_TOKEN</code> secret (Account Analytics: Read) to light this up.
          </div>
        ) : (
          <div style={{ marginBottom: 28 }}>
            {analytics.errors.length > 0 && (
              <div style={{ fontSize: 11, color: '#B3261E', background: '#FBEEF0', border: `1px solid #EAD3D8`, borderRadius: 8, padding: '8px 10px', marginBottom: 10, whiteSpace: 'pre-wrap' }}>
                Diagnostics: {analytics.errors.join('  ·  ')}
              </div>
            )}
            {trafficCards.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 12, marginBottom: 12 }}>
                {trafficCards.map((c) => (
                  <div key={c.label} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px' }}>
                    <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>{c.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: INK }}>{c.value}</div>
                    {c.hint && <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>{c.hint}</div>}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 12, marginBottom: 12 }}>
              {viewsPerDay && viewsPerDay.length > 0 && (
                <AdminGrowthChart label="Album views / day" points={viewsPerDay} color="#21458c" unit="views" />
              )}
              {eventTotals && eventTotals.length > 0 && (
                <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 10 }}>Events · 7 days</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {eventTotals.map((e) => (
                      <span key={e.event} style={{ fontSize: 12, background: '#F5F0E8', color: INK, border: `1px solid ${BORDER}`, borderRadius: 999, padding: '4px 10px' }}>
                        {EVENT_LABELS[e.event] ?? e.event} <strong>{e.count.toLocaleString('en-US')}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {topAlbumsRaw && topAlbumsRaw.length > 0 && (
              <div style={{ overflowX: 'auto', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420 }}>
                  <thead><tr><th style={th}>Top albums · 7d</th><th style={th}>Views</th><th style={th}></th></tr></thead>
                  <tbody>
                    {/* Rows whose album no longer exists are DROPPED, not labelled. The views are
                        real history (analytics outlives the album row), but a "(deleted/unknown)"
                        line answers no question this table is for — which LIVE albums are hot. */}
                    {topAlbumsRaw.filter((a) => topAlbumMeta.has(a.albumId)).map((a) => {
                      const meta = topAlbumMeta.get(a.albumId)
                      return (
                        <tr key={a.albumId}>
                          <td style={{ ...td, whiteSpace: 'normal', maxWidth: 320 }}>{meta?.title ?? '(deleted / unknown)'}</td>
                          <td style={td}>{a.views.toLocaleString('en-US')}</td>
                          <td style={td}>{meta && <a href={`/${meta.slug}`} target="_blank" rel="noreferrer" style={{ color: BRAND }}>open</a>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!workerMetrics && (!eventTotals || eventTotals.length === 0) && (!topAlbumsRaw || topAlbumsRaw.length === 0) && (
              <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>Token is set, but no data came back yet — Cloudflare analytics can lag a few minutes; confirm the token has Account · Account Analytics · Read.</div>
            )}
          </div>
        )}

        {/* Billing reconcile — pull subscriptions straight from Polar (webhook-independent) */}
        <h2 id="ops" style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 10px', scrollMarginTop: 64 }}>Operations</h2>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px', marginBottom: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Payments</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>Reconcile all Polar subscriptions into the DB (provisions accounts by email). Safe to re-run.</div>
          </div>
          <AdminSyncPolarButton />
        </div>

        {/* Announcements — publish to the public /statement archive */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Announcements</div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>Publish a statement to the public <a href="/statement" target="_blank" rel="noreferrer" style={{ color: '#630826', textDecoration: 'underline' }}>/statement</a> archive. Searchable by title & date.</div>
            </div>
          </div>
          <AdminPublishStatement />
        </div>

        {/* BILLING THE WRONG AMOUNT OR THE WRONG INTERVAL. A product's interval cannot be edited
            at Polar once created, so a mis-created one stays wrong until somebody notices — and
            "Studio (Yearly)" charged $100 a MONTH against a page advertising $100 a year. As
            above, 'unknown' is excluded: it means Polar was unreachable, not that a plan is wrong. */}
        {planHealth.some(p => p.state !== 'ok' && p.state !== 'unknown') && (
          <div style={{ background: '#FBE8E7', border: '1px solid #EFCFCC', borderRadius: 12, padding: '12px 16px', marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#B3261E' }}>
              A plan at Polar does not match what we advertise
            </div>
            <p style={{ fontSize: 12, color: '#7A4B47', margin: '4px 0 6px' }}>
              Anyone buying this plan is charged something other than the price on /pricing.
            </p>
            {planHealth.filter(p => p.state !== 'ok' && p.state !== 'unknown').map(p => (
              <div key={p.plan} style={{ fontSize: 12, color: INK }}>
                <strong>{p.plan}</strong>{' — '}
                {p.state === 'wrong-interval' ? p.detail
                  : p.state === 'wrong-price' ? p.detail
                  : p.state === 'missing' ? 'no such product at Polar (archived or deleted?)'
                  : 'no product id is configured'}
              </div>
            ))}
          </div>
        )}

        {/* WHAT THE PANEL OWES THE OWNER ABOUT INTRO PRICING — decided in src/lib/discount-health.
            Three states, not two: the third ('unverified') exists because filtering 'unknown' out
            of the alarm meant a blind probe rendered nothing, and nothing reads as "it works". */}
        {discountBanner(discountHealth) === 'alarm' && (
          <div style={{ background: '#FBE8E7', border: '1px solid #EFCFCC', borderRadius: 12, padding: '12px 16px', marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#B3261E' }}>
              The pricing page is advertising an intro price we cannot charge
            </div>
            <p style={{ fontSize: 12, color: '#7A4B47', margin: '4px 0 6px' }}>
              Eligible first-time buyers are being charged full price. Check the id below against
              the Polar dashboard before recreating anything.
            </p>
            {discountRowsToShow(discountHealth, 'alarm').map(d => (
              <div key={d.plan} style={{ fontSize: 12, color: INK, marginBottom: 3 }}>
                <strong>{d.plan}</strong>{' — '}
                {d.state === 'missing' ? 'the id in our secrets does not exist at Polar'
                  : d.state === 'unset' ? 'no discount id is configured'
                  : 'could not be checked just now'}
                {/* The id is shown because "recreate it and set the secret" is the WRONG advice
                    when the secret holds the wrong PLAN's id — which is what happened here: Pro
                    monthly was configured with the Max discount's id, so every first-time Pro
                    buyer paid full price. Without the id on screen that is invisible. Admin-only,
                    and a discount id is an object identifier, not a credential. */}
                {d.id && (
                  <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A4B47' }}>
                    configured id: {d.id}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {discountBanner(discountHealth) === 'unverified' && (
          <div style={{ background: '#FFF6E5', border: '1px solid #F0DFC0', borderRadius: 12, padding: '10px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#8A6212' }}>
              Could not verify the intro discounts just now
            </div>
            <p style={{ fontSize: 12, color: '#7A6238', margin: '3px 0 6px' }}>
              Not proof anything is broken — but not proof it works either.
            </p>
            {/* The REASON, not a list of three guesses. "expired or unscoped or unreachable" are
                three different problems with three different fixes, and the owner cannot tell
                which one they have from a sentence that offers all three. */}
            {discountRowsToShow(discountHealth, 'unverified').map(d => (
              <div key={d.plan} style={{ fontSize: 12, color: INK }}>
                <strong>{d.plan}</strong>{d.why ? ` — ${d.why}` : ''}
              </div>
            ))}
          </div>
        )}

        {/* Errors and warnings, split — see AdminErrorTabs for why they were separated. */}
        <h2 id="errors" style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 10px', scrollMarginTop: 64 }}>
          Reported from guest devices
        </h2>
        <AdminErrorTabs
          rows={errorsWithOwner}
          seenBefore={[...new Set((clearedMsgsRes.data ?? []).map(r => r.message as string))]}
          // The build this page was served by. A report stamped with anything else came from a
          // browser running code we no longer ship.
          buildId={process.env.NEXT_PUBLIC_BUILD_ID ?? ''}
        />
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px', marginBottom: 28 }}>
          <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: INK }}>Error alerts</p>
          <p style={{ margin: '0 0 10px', fontSize: 12.5, color: MUTED }}>
            8 or more real errors inside 10 minutes sends one email, then stays quiet for an hour. Warnings never trigger it.
          </p>
          <AdminTestAlertButton />
        </div>

        <h2 id="storage" style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 10px', scrollMarginTop: 64 }}>Storage</h2>
        <AdminStorageAudit />

        {/* Recent albums */}
        <h2 id="albums" style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 10px', scrollMarginTop: 64 }}>Recent albums</h2>
        <div style={{ ...scrollBox, marginBottom: 28 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640 }}>
            <thead><tr><th style={th}>Created</th><th style={th}>Title</th><th style={th}>Owner</th><th style={th}>Photos</th><th style={th}>Videos</th><th style={th}></th></tr></thead>
            <tbody>
              {recentAlbums.map((a) => {
                const c = countsByAlbum.get(a.id) ?? { img: 0, vid: 0 }
                const owner = a.user_id ? (emailById.get(a.user_id) ?? '(claimed)') : 'anon'
                return (
                  <tr key={a.id} style={{ opacity: a.retired_at ? 0.5 : 1 }}>
                    <td style={td}>{fmt(a.created_at)}</td>
                    <td style={{ ...td, whiteSpace: 'normal', maxWidth: 240 }}>{a.title}{a.retired_at ? ' (retired)' : ''}</td>
                    <td style={{ ...td, color: a.user_id ? INK : MUTED }}>{owner}</td>
                    <td style={td}>{c.img}</td>
                    <td style={td}>{c.vid}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        {!a.retired_at && <a href={`/${a.custom_slug ?? a.slug}`} target="_blank" rel="noreferrer" style={{ color: BRAND }}>open</a>}
                        <AdminDeleteAlbumButton albumId={a.id} title={a.title} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <h2 id="users" style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 10px', scrollMarginTop: 64 }}>Users &amp; subscriptions</h2>
        {/* Replaced a two-column list of joined-date and email, which could not answer a single
            question worth asking about a customer. */}
        <div style={{ marginBottom: 20 }}>
          {/* registeredTotal is the SAME figure the live Overview card starts from, so the two
              cannot show different totals on one screen. */}
          <AdminUsers
            users={userRows}
            cohorts={cohorts}
            registeredTotal={(usersRes.data as { total?: number } | null)?.total ?? allUsers.length}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 20 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 10px' }}>Subscriptions</h2>
            <div style={scrollBox}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr><th style={th}>Email</th><th style={th}>Tier</th><th style={th}>Status</th></tr></thead>
                <tbody>
                  {payingSubs.length === 0 && <tr><td style={td} colSpan={3}>No subscriptions yet.</td></tr>}
                  {payingSubs.map((s, i) => (
                    <tr key={i}><td style={{ ...td, whiteSpace: 'normal' }}>{s.user_id ? (emailById.get(s.user_id) ?? '(user)') : '—'}</td><td style={td}>{s.tier}</td><td style={td}>{s.status}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Us. Shown rather than hidden, because an account with paid features still needs to be
              findable when something goes wrong with it — it just is not revenue and must never be
              counted as any. */}
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 10px' }}>Admins &amp; comped</h2>
            <div style={scrollBox}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr><th style={th}>Email</th><th style={th}>Tier</th><th style={th}>Why</th></tr></thead>
                <tbody>
                  {houseRows.length === 0 && <tr><td style={td} colSpan={3}>None.</td></tr>}
                  {houseRows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ ...td, whiteSpace: 'normal' }}>{r.email}</td>
                      <td style={td}>{r.tier}</td>
                      <td style={{ ...td, color: MUTED }}>{r.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </main>
  )
}
