import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { deleteAlbumAssetsAndRows } from '@/lib/album-delete'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

type AlbumWithBackground = {
  id: string
  owner_token: string
  user_id: string | null
  custom_slug?: string | null
  background_theme: string | null
  logo_url: string | null
  header_image: string | null
  sponsor_logos: unknown
}

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown } | null
  const { slug } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit<AlbumWithBackground>(req, slug.trim(), 'background_theme, logo_url, header_image, sponsor_logos')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  const admin = createAdminClient()
  // The WHOLE album row's assets, not just the background. Passing a narrower object here is how
  // logos, header images and sponsor marks were left in the bucket forever.
  const result = await deleteAlbumAssetsAndRows(admin, {
    id: access.album.id,
    background_theme: access.album.background_theme,
    logo_url: access.album.logo_url,
    header_image: access.album.header_image,
    sponsor_logos: access.album.sponsor_logos,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500, headers: NO_STORE })
  }

  const cookieStore = await cookies()
  cookieStore.delete(`hushare_owner_${access.album.id}`)
  // No anon-cap bookkeeping needed here: the create route lists anon album IDs and prunes any that no
  // longer exist, so deleting this album automatically frees its slot on the next create.

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
