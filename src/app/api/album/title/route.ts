import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; title?: unknown } | null
  const { slug, title } = body ?? {}

  if (typeof slug !== 'string' || typeof title !== 'string') {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }
  const cleanTitle = title.trim().replace(/[\x00-\x1F\x7F]/g, '')
  if (cleanTitle.length < 1 || cleanTitle.length > 120) {
    return NextResponse.json({ error: 'Title must be 1–120 characters' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, slug.trim())
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  const admin = createAdminClient()
  const { error } = await admin.from('albums').update({ title: cleanTitle }).eq('id', access.album.id)
  if (error) {
    console.error('[album/title] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update title' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
