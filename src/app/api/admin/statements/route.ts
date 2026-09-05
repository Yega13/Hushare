import { NextResponse } from 'next/server'
import type { Database } from '@/types/database'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'statement'
}

// Admin-only: publish a statement to the public /statement archive.
export async function POST(req: Request) {
  const csrf = forbidCrossSiteRequest(req)
  if (csrf) return csrf

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!isAccountAdmin(user)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  }

  let body: { title?: string; summary?: string; body_html?: string; slug?: string; published_at?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE })
  }

  const title = (body.title ?? '').trim()
  const bodyHtml = (body.body_html ?? '').trim()
  const summary = (body.summary ?? '').trim() || null
  if (!title || !bodyHtml) {
    return NextResponse.json({ error: 'Title and body are required.' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()

  // Ensure a unique slug (append -2, -3, … on collision).
  const base = (body.slug ? slugify(body.slug) : slugify(title))
  let slug = base
  for (let n = 2; n <= 50; n++) {
    const { data: existing } = await admin.from('statements').select('slug').eq('slug', slug).maybeSingle()
    if (!existing) break
    slug = `${base}-${n}`
  }

  const row: Database['public']['Tables']['statements']['Insert'] = { slug, title, summary, body_html: bodyHtml }
  if (body.published_at) {
    const ts = new Date(body.published_at)
    if (!Number.isNaN(ts.getTime())) row.published_at = ts.toISOString()
  }

  const { error } = await admin.from('statements').insert(row)
  if (error) {
    console.error('[admin/statements] insert failed:', error.message)
    return NextResponse.json({ error: `Could not publish — ${error.message}` }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, slug, url: `/statement/${slug}` }, { headers: NO_STORE })
}
