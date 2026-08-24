import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { fetchAuthorizedPhotos } from '@/lib/server/album-access'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Thin wrapper over the shared fetchAuthorizedPhotos() (src/lib/server/album-access.ts), also used
// by the server-rendered album page so the owner/password/reveal checks can never drift apart.
export async function GET(req: Request) {
  // The heaviest read in the app -- up to 2000 photo rows plus an exact count -- and it was the
  // only one with no limit at all, while album/resolve beside it carries 900/min. For an open album
  // it needs no authentication, so a single album id was enough to hammer the shared Supabase
  // instance and degrade every customer's album at once.
  //
  // Generous, because this is a legitimate path a real album page hits repeatedly (pagination, the
  // live wall, delta refreshes) and the ceiling must never be reachable by ordinary browsing.
  // failOpen: a limiter blip must not stop people looking at their photos.
  const rl = await checkRateLimit(clientIpKey(req, 'album_photos'), 60, 600, { failOpen: true })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds), ...NO_STORE } },
    )
  }

  const url = new URL(req.url)
  const albumId = url.searchParams.get('albumId') ?? ''
  // `recent` (the live wall) caps the response to the newest N photos + returns the true total.
  const recentRaw = Number(url.searchParams.get('recent'))
  const recentLimit = Number.isFinite(recentRaw) && recentRaw > 0 ? Math.min(200, Math.floor(recentRaw)) : undefined
  // Pagination window for the full album view (a big album's "load more"). fetchAuthorizedPhotos
  // clamps the limit to ALBUM_PAGE_SIZE; omitted params reproduce the original single-shot fetch.
  const offsetRaw = Number(url.searchParams.get('offset'))
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : undefined
  const limitRaw = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : undefined
  const cookieStore = await cookies()

  try {
    const result = await fetchAuthorizedPhotos(albumId, cookieStore, { recentLimit, offset, limit })
    switch (result.kind) {
      case 'invalid':
        return NextResponse.json({ error: 'Invalid album id' }, { status: 400, headers: NO_STORE })
      case 'notfound':
        return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
      case 'reveal':
        return NextResponse.json({ error: 'Locked' }, { status: 403, headers: NO_STORE })
      case 'password':
        return NextResponse.json({ error: 'Password required' }, { status: 403, headers: NO_STORE })
      case 'ok':
        return NextResponse.json({ photos: result.photos, total: result.total }, { headers: NO_STORE })
    }
  } catch {
    return NextResponse.json({ error: 'Failed to load photos' }, { status: 500, headers: NO_STORE })
  }
}
