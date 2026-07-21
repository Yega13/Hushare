import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Admin-only: "clear" the Errors view by marking all currently-unresolved error_events as resolved.
// The rows are NOT deleted — they drop out of the active admin view but remain (recoverable) until
// the existing 30-day prune removes them. Lets the admin acknowledge solved errors and surface new ones.
export async function POST(req: Request) {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!isAccountAdmin(user)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('error_events')
    .update({ resolved_at: new Date().toISOString() })
    .is('resolved_at', null)

  if (error) {
    console.error('[admin/errors/reset] update failed:', error.message)
    return NextResponse.json({ error: 'Could not clear errors' }, { status: 500, headers: NO_STORE })
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
