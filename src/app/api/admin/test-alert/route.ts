import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAccountAdmin } from '@/lib/auth'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { sendErrorSpikeEmail } from '@/lib/email'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Sends the real alert email on demand, and reports back what actually happened.
//
// The alerting was verified by inserting synthetic error rows and watching Worker logs, which is
// not a thing anyone should have to do twice. An alarm nobody can test is an alarm nobody trusts,
// so this exists to answer "will it reach me?" in one click — including the failure reason, rather
// than the silence that made the first attempt so slow to diagnose.
export async function POST(req: Request) {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!isAccountAdmin(user)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  }

  const to = process.env.ERROR_ALERT_EMAIL
  if (!to) {
    return NextResponse.json({ error: 'ERROR_ALERT_EMAIL is not set on the Worker.' }, { status: 400, headers: NO_STORE })
  }

  try {
    await sendErrorSpikeEmail(to, {
      count: 8,
      windowMinutes: 10,
      deviceCount: 2,
      test: true,
      top: [['Example: a photo failed to upload after the connection dropped', 8]],
    })
  } catch (e) {
    // Surfaced to the browser rather than only the server log: the point is that the admin finds
    // out here, now.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502, headers: NO_STORE },
    )
  }

  return NextResponse.json({ ok: true, to: to.trim() }, { headers: NO_STORE })
}
