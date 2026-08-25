import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { deleteR2ObjectByPublicUrl } from '@/lib/cloudflare/r2'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Save (or clear) the signed-in account's avatar.
//
// The URL arriving here is client-supplied, so it is checked against the one place it is allowed to
// come from: this R2 bucket, under THIS account's own prefix. Without that check the field is an
// open redirect painted onto the account page, and worse, a way to point one person's avatar at
// another person's object.
function isOwnAvatarUrl(url: string, userId: string): boolean {
  const host = process.env.R2_PUBLIC_HOST
  if (!host) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  // Exact host, not endsWith: "evil-hushare.example" ends with nothing useful, but a suffix check on
  // a host is the classic way this goes wrong.
  if (parsed.host !== host.replace(/^https?:\/\//, '').replace(/\/$/, '')) return false
  // The path must sit under this user's own folder, and the segment must match whole — /avatars/<id>/
  // with the trailing slash, so one user id cannot prefix another's.
  return parsed.pathname.startsWith(`/avatars/${userId}/`)
}

export async function POST(req: Request) {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in first' }, { status: 401, headers: NO_STORE })

  const body = await req.json().catch(() => null) as { avatarUrl?: unknown } | null
  const raw = body?.avatarUrl
  const clearing = raw === null
  if (!clearing && (typeof raw !== 'string' || !isOwnAvatarUrl(raw, user.id))) {
    return NextResponse.json({ error: 'Invalid image' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()

  // The previous object, so replacing a picture does not quietly accumulate them in R2. Read before
  // the write, deleted after — an image left behind costs a few KB, whereas deleting first and then
  // failing to save would leave the account pointing at nothing.
  const { data: existing } = await admin
    .from('profiles').select('avatar_url').eq('user_id', user.id).maybeSingle<{ avatar_url: string | null }>()

  const { error } = await admin
    .from('profiles')
    .upsert({ user_id: user.id, avatar_url: clearing ? null : (raw as string), updated_at: new Date().toISOString() })

  if (error) {
    console.error('[account/avatar] save failed:', error.message)
    return NextResponse.json({ error: 'Could not save' }, { status: 500, headers: NO_STORE })
  }

  const previous = existing?.avatar_url
  if (previous && previous !== raw) {
    // Fire-and-forget by design — the helper is synchronous and swallows its own failures. A
    // leftover object is not worth making somebody wait for, nor worth failing a save that has
    // already succeeded.
    deleteR2ObjectByPublicUrl(previous)
  }

  return NextResponse.json({ ok: true, avatarUrl: clearing ? null : raw }, { headers: NO_STORE })
}
