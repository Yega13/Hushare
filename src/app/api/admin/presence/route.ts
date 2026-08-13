import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Marketing / top-level pages we label by name; every other single-segment path is an album view.
const MARKETING = new Set([
  'pricing', 'about', 'login', 'account', 'contact', 'statement', 'admin',
  'races', 'blog', 'terms', 'privacy', 'auth', 'help', 'support',
])

function pageLabel(path: string | null): string {
  if (!path) return 'other'
  const seg = path.split('?')[0].split('#')[0].split('/')[1] ?? ''
  if (seg === '') return 'home'
  if (MARKETING.has(seg)) return '/' + seg
  return 'album'
}

// Admin-only: the live active-user count. "Active" = a heartbeat in the last 70s (tabs ping ~every
// 30s). Returns the total plus a per-page breakdown. Polled by AdminLiveUsers for the real-time feel.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!isAccountAdmin(user)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const since = new Date(Date.now() - 70 * 1000).toISOString()
  // Exact total via a head count (never capped), plus a bounded row sample for the per-page split.
  const [countRes, rowsRes] = await Promise.all([
    admin.from('active_sessions').select('id', { count: 'exact', head: true }).gte('last_seen', since),
    admin.from('active_sessions').select('path').gte('last_seen', since).limit(3000),
  ])
  if (countRes.error && rowsRes.error) {
    return NextResponse.json({ error: 'query failed' }, { status: 500, headers: NO_STORE })
  }

  const rows = rowsRes.data ?? []
  const total = countRes.count ?? rows.length
  const byPage = new Map<string, number>()
  for (const r of rows) {
    const label = pageLabel(r.path as string | null)
    byPage.set(label, (byPage.get(label) ?? 0) + 1)
  }
  const pages = [...byPage.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  return NextResponse.json({ total, pages, at: Date.now() }, { headers: NO_STORE })
}
