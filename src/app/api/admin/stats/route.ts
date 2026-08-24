import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// The countable half of the admin dashboard, refetchable without a page reload.
//
// The page is server-rendered, so every number on it was a snapshot from whenever it was last
// loaded — which is exactly wrong for the screen you keep open during an event to watch whether
// uploads are still landing. This returns just the cheap counts so the client can poll them.
//
// Deliberately EXCLUDES R2 and Stream usage. Those are calls out to Cloudflare's API, they change
// slowly, and polling them every twenty seconds would spend a rate limit to watch a number move
// once an hour. They stay server-rendered on page load.
//
// Returns 404 rather than 403 for non-admins, matching every other admin route: a 403 confirms the
// endpoint exists and is worth attacking, a 404 says nothing.
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!isAccountAdmin(user)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  }

  // Polled by an open dashboard, so it needs a ceiling — an admin tab left open for a week should
  // not be able to run up an unbounded count query bill by itself.
  const rl = await checkRateLimit(clientIpKey(req, 'admin_stats'), 60, 120, { failOpen: true })
  if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: NO_STORE })

  const admin = createAdminClient()
  const head = { count: 'exact' as const, head: true }

  const [albums, photos, videos, subs, errors, users] = await Promise.all([
    admin.from('albums').select('id', head).is('retired_at', null),
    admin.from('photos').select('id', head).eq('media_type', 'image'),
    admin.from('photos').select('id', head).eq('media_type', 'video'),
    admin.from('subscriptions').select('id', head).eq('status', 'active'),
    admin.from('error_events').select('id', head).eq('level', 'error').is('resolved_at', null),
    // listUsers has no count-only mode; one page of 1 is the cheapest way to read the total.
    admin.auth.admin.listUsers({ page: 1, perPage: 1 }),
  ])

  return NextResponse.json(
    {
      albums: albums.count ?? 0,
      photos: photos.count ?? 0,
      videos: videos.count ?? 0,
      users: (users.data as { total?: number } | null)?.total ?? users.data?.users?.length ?? 0,
      subscriptions: subs.count ?? 0,
      openErrors: errors.count ?? 0,
      at: Date.now(),
    },
    { headers: NO_STORE },
  )
}
