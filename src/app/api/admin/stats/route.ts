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

  const [albums, photos, videos, subs, errors, users, backup] = await Promise.all([
    admin.from('albums').select('id', head).is('retired_at', null),
    admin.from('photos').select('id', head).eq('media_type', 'image'),
    admin.from('photos').select('id', head).eq('media_type', 'video'),
    admin.from('subscriptions').select('id', head).eq('status', 'active'),
    admin.from('error_events').select('id', head).eq('level', 'error').is('resolved_at', null),
    // listUsers has no count-only mode; one page of 1 is the cheapest way to read the total.
    admin.auth.admin.listUsers({ page: 1, perPage: 1 }),
    // WHEN THE DATABASE WAS LAST COPIED SOMEWHERE ELSE.
    //
    // Written by scripts/backup-upload.mjs, and only after an upload actually SUCCEEDS. The nightly
    // job failed silently two nights running because the R2 secrets were never set on the repo:
    // the dump ran, the upload exited, and the copy went in the bin with the runner. Nothing said
    // so anywhere the owner looks, so nothing was noticed for two days.
    //
    // Supabase's free plan takes no backups of its own, so "how long since a real copy" is not a
    // nice-to-have number — it is the difference between an incident and the end of the product.
    admin.from('system_state').select('value, updated_at').eq('key', 'last_backup_at').maybeSingle(),
  ])

  const backupRow = backup.data as { updated_at?: string } | null
  const lastBackupAt = backupRow?.updated_at ?? null
  const backupAgeHours = lastBackupAt
    ? Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / 3600e3)
    : null

  return NextResponse.json(
    {
      albums: albums.count ?? 0,
      photos: photos.count ?? 0,
      videos: videos.count ?? 0,
      users: (users.data as { total?: number } | null)?.total ?? users.data?.users?.length ?? 0,
      subscriptions: subs.count ?? 0,
      openErrors: errors.count ?? 0,
      // null means no successful backup has ever been recorded — which is a louder statement than
      // any number, and exactly the state the product was in on 2026-08-26.
      lastBackupAt,
      backupAgeHours,
      // The nightly job runs at 03:15 UTC. 36 hours means a night has been missed outright rather
      // than the run simply being a few hours late.
      backupStale: backupAgeHours === null || backupAgeHours > 36,
      at: Date.now(),
    },
    { headers: NO_STORE },
  )
}
