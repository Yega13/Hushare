import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'
import { getPoll } from '@/lib/polls'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Aggregate votes for a poll. Low volume (a design poll), so a select + JS tally is fine; swap for
// a group-by RPC if a poll ever gets huge.
async function tally(pollKey: string): Promise<{ tallies: Record<string, number>; total: number }> {
  const admin = createAdminClient()
  const { data } = await admin.from('poll_votes').select('option_key').eq('poll_key', pollKey)
  const tallies: Record<string, number> = {}
  let total = 0
  for (const row of (data ?? []) as { option_key: string }[]) {
    tallies[row.option_key] = (tallies[row.option_key] ?? 0) + 1
    total++
  }
  return { tallies, total }
}

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }): Promise<Response> {
  // tally() reads every vote row for the poll on each call, and this was the one public GET with no
  // limit in front of it. failOpen: a poll is decoration, and a limiter blip must not break a page.
  const rl = await checkRateLimit(clientIpKey(req, 'poll_read'), 60, 120, { failOpen: true })
  if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: NO_STORE })

  const { key } = await params
  const poll = getPoll(key)
  if (!poll) return NextResponse.json({ error: 'Unknown poll' }, { status: 404, headers: NO_STORE })
  const { tallies, total } = await tally(key)
  return NextResponse.json({ question: poll.question, note: poll.note ?? null, options: poll.options, tallies, total }, { headers: NO_STORE })
}

export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }): Promise<Response> {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  const { key } = await params
  const poll = getPoll(key)
  if (!poll) return NextResponse.json({ error: 'Unknown poll' }, { status: 404, headers: NO_STORE })

  const rl = await checkRateLimit(clientIpKey(req, 'poll'), 60, 20, { failOpen: true })
  if (!rl.ok) return NextResponse.json({ error: "You're voting a little fast — give it a moment." }, { status: 429, headers: NO_STORE })

  let body: { option_key?: unknown; voter_id?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE }) }

  const optionKey = typeof body.option_key === 'string' ? body.option_key : ''
  const voterId = typeof body.voter_id === 'string' ? body.voter_id.slice(0, 64) : ''
  if (!poll.options.some((o) => o.key === optionKey)) {
    return NextResponse.json({ error: 'Invalid option' }, { status: 400, headers: NO_STORE })
  }
  if (voterId.length < 8) {
    return NextResponse.json({ error: 'Invalid voter id' }, { status: 400, headers: NO_STORE })
  }

  // Upsert on (poll_key, voter_id): first vote inserts, a re-vote changes the choice. Never inflates
  // the tally beyond one-per-browser.
  const admin = createAdminClient()
  const { error } = await admin
    .from('poll_votes')
    .upsert({ poll_key: key, option_key: optionKey, voter_id: voterId }, { onConflict: 'poll_key,voter_id' })
  if (error) {
    console.error('[poll] vote upsert failed:', error.message)
    return NextResponse.json({ error: 'Could not record your vote' }, { status: 500, headers: NO_STORE })
  }

  const { tallies, total } = await tally(key)
  return NextResponse.json({ ok: true, tallies, total }, { headers: NO_STORE })
}
