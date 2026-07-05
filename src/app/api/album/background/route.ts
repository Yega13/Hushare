import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { broadcastAlbumSettings } from '@/lib/broadcast'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

type BgAlbum = {
  id: string
  owner_token: string
  user_id: string | null
  custom_slug?: string | null
  background_theme: string | null
}

function isValidBackgroundTheme(theme: string | null, r2Host: string): boolean {
  if (theme === null) return true
  // Hex color: #RGB or #RRGGBB
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(theme)) return true
  // Custom uploaded image — must come from our R2 CDN with the backgrounds/ prefix
  if (theme.startsWith('image:')) {
    const url = theme.slice(6)
    // Normalise through URL constructor to decode percent-encoding before traversal check.
    // Without this, %2e%2e bypasses the literal '..' check.
    try {
      const parsed = new URL(url)
      if (parsed.origin !== `https://${r2Host}`) return false
      if (!parsed.pathname.startsWith('/backgrounds/')) return false
      if (parsed.pathname.includes('..')) return false
      return true
    } catch { return false }
  }
  // Stock SVG names — lowercase alphanumeric + hyphens only
  if (theme.startsWith('stock:')) {
    return /^stock:[a-z0-9-]+$/.test(theme)
  }
  return false
}

export async function POST(req: Request) {
  const csrfError = forbidCrossSiteRequest(req)
  if (csrfError) return csrfError

  const body = await req.json().catch(() => null) as { slug?: unknown; background_theme?: unknown } | null
  const { slug, background_theme } = body ?? {}

  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (background_theme !== null && typeof background_theme !== 'string') {
    return NextResponse.json({ error: 'Invalid background_theme' }, { status: 400, headers: NO_STORE })
  }

  if (typeof background_theme === 'string' && background_theme.length > 512) {
    return NextResponse.json({ error: 'Invalid background_theme value' }, { status: 400, headers: NO_STORE })
  }
  const theme = typeof background_theme === 'string' ? background_theme.trim() : null

  // r2Host is needed for both validating the incoming theme and cleaning up the old one.
  const r2Host = (process.env.R2_PUBLIC_HOST ?? '').trim().replace(/\/+$/, '')
  if (theme !== null && theme.startsWith('image:') && !r2Host) {
    console.error('[album/background] R2_PUBLIC_HOST not set')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500, headers: NO_STORE })
  }

  if (!isValidBackgroundTheme(theme, r2Host)) {
    return NextResponse.json({ error: 'Invalid background_theme value' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit<BgAlbum>(req, slug.trim(), 'background_theme')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })

  const admin = createAdminClient()
  const { error } = await admin.from('albums').update({ background_theme: theme }).eq('id', access.album.id)
  if (error) {
    console.error('[album/background] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update background' }, { status: 500, headers: NO_STORE })
  }

  // Clean up the previous custom background from R2 — best-effort, non-fatal.
  // Skip when theme is unchanged: deleting here would orphan the still-active R2 object.
  const oldTheme = access.album.background_theme
  if (oldTheme?.startsWith('image:') && r2Host && oldTheme !== theme) {
    const oldUrl = oldTheme.slice(6)
    const prefix = `https://${r2Host}/`
    if (oldUrl.startsWith(prefix)) {
      const oldKey = oldUrl.slice(prefix.length).split('?')[0]
      if (oldKey) {
        try {
          const ctx = getCloudflareContext()
          const bucket = (ctx?.env as { R2_BUCKET?: { delete(k: string | string[]): Promise<void> } } | undefined)?.R2_BUCKET
          if (bucket) await bucket.delete(oldKey)
        } catch (e) {
          console.error('[album/background] failed to delete old background from R2:', e instanceof Error ? e.message : String(e))
        }
      }
    }
  }

  await broadcastAlbumSettings(access.album.id, { background_theme: theme })

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
