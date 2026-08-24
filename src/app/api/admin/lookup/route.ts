import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'
import { getActiveSubscription, getUserTierById } from '@/lib/subscriptions'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Extract an album slug from raw input: a bare slug, or a full/partial link. Sanitised to slug chars
// so it can only ever feed a parameterised .eq() (no filter injection).
function parseSlug(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^https?:\/\/[^/]+/i, '') // strip origin if a full URL
  s = s.split('#')[0].split('?')[0]
  s = s.replace(/^\/+/, '').split('/')[0]  // first path segment
  return s.replace(/[^a-zA-Z0-9_-]/g, '')
}

type AdminDb = ReturnType<typeof createAdminClient>

async function findUserByEmail(admin: AdminDb, email: string) {
  const normalized = email.trim().toLowerCase()

  // Same 5,000-user ceiling that was silently dropping payments in provision-user: 25 pages x 200
  // and then give up. Here the consequence is smaller -- support simply cannot find a customer --
  // but it is the same cliff, and it arrives without warning. One indexed lookup instead.
  const { data: id, error: rpcErr } = await admin.rpc('find_user_id_by_email', { p_email: normalized })
  if (!rpcErr && typeof id === 'string' && id) {
    const { data } = await admin.auth.admin.getUserById(id)
    if (data?.user) return data.user
  }

  // Fallback for a database restored from before that migration.
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) break
    const found = data.users.find((u) => (u.email ?? '').toLowerCase() === normalized)
    if (found) return found
    if (data.users.length < 200) break
  }
  return null
}

// Aggregate photo/video counts for a set of album IDs (paginated — a single select silently caps at
// max_rows and would undercount big albums).
async function countsByAlbum(admin: AdminDb, albumIds: string[]) {
  const map = new Map<string, { img: number; vid: number }>()
  if (!albumIds.length) return map
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('photos').select('album_id, media_type').in('album_id', albumIds)
      .order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    for (const m of data as { album_id: string; media_type: string }[]) {
      const c = map.get(m.album_id) ?? { img: 0, vid: 0 }
      if (m.media_type === 'video') c.vid++; else c.img++
      map.set(m.album_id, c)
    }
    if (data.length < PAGE) break
  }
  return map
}

// Admin-only: look up a user by email OR an album by link/slug, for the support panel.
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!isAccountAdmin(user)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (!q) return NextResponse.json({ type: 'none' }, { headers: NO_STORE })

  const admin = createAdminClient()

  // ── Email → account ──
  if (q.includes('@')) {
    const u = await findUserByEmail(admin, q)
    if (!u) return NextResponse.json({ type: 'none', hint: 'No account with that email.' }, { headers: NO_STORE })
    const { data: albumsRaw } = await admin
      .from('albums').select('id, slug, custom_slug, title, created_at, last_activity_at, retired_at')
      .eq('user_id', u.id).order('created_at', { ascending: false }).limit(60)
    const albums = (albumsRaw ?? []) as { id: string; slug: string; custom_slug: string | null; title: string; created_at: string; last_activity_at: string | null; retired_at: string | null }[]
    const counts = await countsByAlbum(admin, albums.map((a) => a.id))
    // Effective tier is the source of truth for what the user can actually access (it includes the
    // admin-email override + comp subs), separate from whether they have a paid subscription row.
    const [sub, effectiveTier] = await Promise.all([getActiveSubscription(u.id), getUserTierById(u.id)])
    return NextResponse.json({
      type: 'user',
      user: { id: u.id, email: u.email ?? null, created_at: u.created_at ?? null },
      effectiveTier,
      subscription: sub ? { tier: sub.tier, status: sub.status, current_period_end: sub.current_period_end, product: sub.polar_product_id } : null,
      albums: albums.map((a) => {
        const c = counts.get(a.id) ?? { img: 0, vid: 0 }
        return { id: a.id, slug: a.custom_slug ?? a.slug, title: a.title, created_at: a.created_at, last_activity_at: a.last_activity_at, retired: !!a.retired_at, img: c.img, vid: c.vid }
      }),
    }, { headers: NO_STORE })
  }

  // ── Album link/slug → album ──
  const slug = parseSlug(q)
  if (!slug) return NextResponse.json({ type: 'none' }, { headers: NO_STORE })
  const cols = 'id, slug, custom_slug, title, user_id, created_at, last_activity_at, retired_at, guest_uploads_enabled'
  let { data: album } = await admin.from('albums').select(cols).eq('slug', slug).maybeSingle()
  if (!album) {
    const r = await admin.from('albums').select(cols).eq('custom_slug', slug).maybeSingle()
    album = r.data
  }
  if (!album) return NextResponse.json({ type: 'none', hint: 'No album with that link/slug.' }, { headers: NO_STORE })
  const a = album as { id: string; slug: string; custom_slug: string | null; title: string; user_id: string | null; created_at: string; last_activity_at: string | null; retired_at: string | null; guest_uploads_enabled: boolean }
  const c = (await countsByAlbum(admin, [a.id])).get(a.id) ?? { img: 0, vid: 0 }
  let ownerEmail: string | null = null
  if (a.user_id) {
    const { data: au } = await admin.auth.admin.getUserById(a.user_id)
    ownerEmail = au?.user?.email ?? null
  }
  return NextResponse.json({
    type: 'album',
    album: {
      id: a.id, slug: a.custom_slug ?? a.slug, title: a.title,
      created_at: a.created_at, last_activity_at: a.last_activity_at, retired: !!a.retired_at,
      guestUploads: !!a.guest_uploads_enabled, img: c.img, vid: c.vid,
      ownerEmail, ownerType: a.user_id ? 'registered' : 'anonymous',
    },
  }, { headers: NO_STORE })
}
