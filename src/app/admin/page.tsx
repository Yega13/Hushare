import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'
import AdminRefreshButton from '@/components/AdminRefreshButton'
import AdminResetErrorsButton from '@/components/AdminResetErrorsButton'
import AdminDeleteAlbumButton from '@/components/AdminDeleteAlbumButton'

// Live data, never cached, never indexed. Access is gated to ADMIN_EMAILS below.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } }

const INK = '#2A211C'
const BRAND = '#630826'
const MUTED = '#8A7A66'
const CARD = '#FFFFFF'
const BORDER = '#E4DAC9'

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

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const [
    albumsActive, albumsRetired, imgCount, vidCount, subsCount,
    recentAlbumsRes, subsRes, streamUsage, usersRes, errors24Res, recentErrorsRes,
  ] = await Promise.all([
    admin.from('albums').select('id', { count: 'exact', head: true }).is('retired_at', null),
    admin.from('albums').select('id', { count: 'exact', head: true }).not('retired_at', 'is', null),
    admin.from('photos').select('id', { count: 'exact', head: true }).eq('media_type', 'image'),
    admin.from('photos').select('id', { count: 'exact', head: true }).eq('media_type', 'video'),
    admin.from('subscriptions').select('id', { count: 'exact', head: true }),
    admin.from('albums').select('id, slug, custom_slug, title, user_id, created_at, retired_at')
      .order('created_at', { ascending: false }).limit(40).returns<AlbumRow[]>(),
    admin.from('subscriptions').select('user_id, tier, status, current_period_end, created_at')
      .order('created_at', { ascending: false }).limit(30),
    getStreamUsage(),
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    admin.from('error_events').select('id', { count: 'exact', head: true }).eq('level', 'error').is('resolved_at', null).gte('created_at', dayAgo),
    admin.from('error_events').select('created_at, level, source, message, album_id, ua')
      .is('resolved_at', null)
      .order('created_at', { ascending: false }).limit(60)
      .returns<{ created_at: string; level: string; source: string; message: string; album_id: string | null; ua: string | null }[]>(),
  ])

  const recentAlbums = recentAlbumsRes.data ?? []
  const subs = subsRes.data ?? []
  const allUsers = usersRes.data?.users ?? []
  const recentErrors = recentErrorsRes.data ?? []
  // Group recent errors by message to show the top recurring problems.
  const errorTally = new Map<string, number>()
  for (const e of recentErrors) errorTally.set(e.message, (errorTally.get(e.message) ?? 0) + 1)
  const topErrors = [...errorTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)

  // id → email map for owners + recent signups (one listUsers call, no N+1)
  const emailById = new Map<string, string>()
  for (const u of allUsers) if (u.id) emailById.set(u.id, u.email ?? '(no email)')

  // Per-album media counts for the recent list (one photos query, aggregated in JS)
  const albumIds = recentAlbums.map(a => a.id)
  const countsByAlbum = new Map<string, { img: number; vid: number }>()
  if (albumIds.length) {
    const { data: media } = await admin.from('photos').select('album_id, media_type').in('album_id', albumIds)
    for (const m of media ?? []) {
      const c = countsByAlbum.get(m.album_id) ?? { img: 0, vid: 0 }
      if (m.media_type === 'video') c.vid++; else c.img++
      countsByAlbum.set(m.album_id, c)
    }
  }

  const recentSignups = [...allUsers]
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, 15)

  const cards: { label: string; value: string; hint?: string }[] = [
    { label: 'Active albums', value: String(albumsActive.count ?? 0), hint: `${albumsRetired.count ?? 0} retired` },
    { label: 'Photos', value: String(imgCount.count ?? 0) },
    { label: 'Videos', value: String(vidCount.count ?? 0) },
    { label: 'Registered users', value: String(allUsers.length) + (allUsers.length >= 200 ? '+' : ''), hint: 'accounts (most albums are anon)' },
    { label: 'Subscriptions', value: String(subsCount.count ?? 0), hint: 'paid' },
    streamUsage
      ? { label: 'Stream video', value: `${streamUsage.minutes} / ${streamUsage.limit} min`, hint: `${streamUsage.videos} videos stored` }
      : { label: 'Stream video', value: 'n/a', hint: 'CF token missing' },
    { label: 'Errors (24h)', value: String(errors24Res.count ?? 0), hint: (errors24Res.count ?? 0) > 0 ? 'see below ↓' : 'all clear' },
  ]

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: MUTED, fontWeight: 600, borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: INK, borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap' }

  return (
    <main style={{ minHeight: '100vh', background: '#FDFAF5', padding: '28px 20px', fontFamily: 'var(--font-sans)' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: BRAND, fontFamily: 'var(--font-serif)' }}>Hushare Admin</h1>
          <div style={{ display: 'flex', gap: 14, fontSize: 13, alignItems: 'center' }}>
            {/* Real tab reload (client) — re-runs the dynamic page for fresh data. */}
            <AdminRefreshButton />
            <Link href="/account" style={{ color: MUTED }}>Account</Link>
          </div>
        </div>
        <p style={{ fontSize: 12, color: MUTED, marginBottom: 22 }}>Signed in as {user?.email}. Live data — reload to update.</p>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 28 }}>
          {cards.map((c) => (
            <div key={c.label} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: INK }}>{c.value}</div>
              {c.hint && <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>{c.hint}</div>}
            </div>
          ))}
        </div>

        {/* Errors — top recurring + recent stream */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, margin: '0 0 10px' }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: 0 }}>
            Errors <span style={{ fontSize: 12, fontWeight: 400, color: MUTED }}>(real guest failures reported from their devices)</span>
          </h2>
          {recentErrors.length > 0 && <AdminResetErrorsButton />}
        </div>
        {recentErrors.length === 0 ? (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px', marginBottom: 28, fontSize: 13, color: MUTED }}>
            No errors reported. 🎉 If a guest hits an upload failure, it shows up here with the device and reason.
          </div>
        ) : (
          <div style={{ marginBottom: 28 }}>
            {topErrors.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {topErrors.map(([msg, n]) => (
                  <span key={msg} style={{ fontSize: 12, background: '#FBEEF0', color: BRAND, border: `1px solid #EAD3D8`, borderRadius: 999, padding: '4px 10px' }}>
                    <strong>{n}×</strong> {msg.slice(0, 60)}{msg.length > 60 ? '…' : ''}
                  </span>
                ))}
              </div>
            )}
            <div style={{ overflowX: 'auto', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 680 }}>
                <thead><tr><th style={th}>When</th><th style={th}>Lvl</th><th style={th}>Source</th><th style={th}>Message</th><th style={th}>Device</th></tr></thead>
                <tbody>
                  {recentErrors.map((e, i) => (
                    <tr key={i}>
                      <td style={td}>{fmt(e.created_at)}</td>
                      <td style={{ ...td, color: e.level === 'error' ? '#B3261E' : '#8A6D00' }}>{e.level}</td>
                      <td style={td}>{e.source}</td>
                      <td style={{ ...td, whiteSpace: 'normal', maxWidth: 320 }}>{e.message}</td>
                      <td style={{ ...td, whiteSpace: 'normal', maxWidth: 180, fontSize: 11, color: MUTED }}>{(e.ua ?? '').replace(/Mozilla\/[\d.]+ /,'').slice(0, 60)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Recent albums */}
        <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 10px' }}>Recent albums</h2>
        <div style={{ overflowX: 'auto', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, marginBottom: 28 }}>
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

        {/* Two columns: signups + subscriptions */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 10px' }}>Recent signups</h2>
            <div style={{ overflowX: 'auto', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr><th style={th}>Joined</th><th style={th}>Email</th></tr></thead>
                <tbody>
                  {recentSignups.length === 0 && <tr><td style={td} colSpan={2}>No registered users yet.</td></tr>}
                  {recentSignups.map((u) => (
                    <tr key={u.id}><td style={td}>{u.created_at ? fmt(u.created_at) : '—'}</td><td style={{ ...td, whiteSpace: 'normal' }}>{u.email ?? '(no email)'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 10px' }}>Subscriptions</h2>
            <div style={{ overflowX: 'auto', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr><th style={th}>Email</th><th style={th}>Tier</th><th style={th}>Status</th></tr></thead>
                <tbody>
                  {subs.length === 0 && <tr><td style={td} colSpan={3}>No subscriptions yet.</td></tr>}
                  {subs.map((s, i) => (
                    <tr key={i}><td style={{ ...td, whiteSpace: 'normal' }}>{s.user_id ? (emailById.get(s.user_id) ?? '(user)') : '—'}</td><td style={td}>{s.tier}</td><td style={td}>{s.status}</td></tr>
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
