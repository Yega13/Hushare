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
  // 6000/min, not 600. THIS CEILING WAS THE REAL EVENT FAILURE, and it is worth being exact about
  // why: clientIpKey keys on cf-connecting-ip, which at a venue is ONE public IP shared by every
  // guest on the WiFi. 300 guests do not get 300 buckets; they get one. A single upload burst has
  // every phone refetch, so 300 requests land at once, and a few bursts a minute exhausted 600 —
  // at which point every screen in the room 429s together and the albums blank simultaneously.
  //
  // The old number was chosen for one abusive client, not for a room. 6000 fits 300 guests
  // refetching on the 2.5s debounce (24/min each) with headroom, and still stops a runaway loop.
  //
  // This is a READ of an album the caller can already open, and the photos themselves are served
  // publicly from the CDN — so there is little here worth scraping that is not already public. The
  // limiter is a runaway-loop backstop, not an access control, and it should be sized as one.
  // 20000. The previous 6000 was already a raise from 600, but it was still short: at peak each
  // guest refetches every 2.5s (24/min), so 300 guests is 7200/min and 500 is 12000. Being refused
  // here means an album that stops updating during the event it was made for.
  const rl = await checkRateLimit(clientIpKey(req, 'album_photos'), 60, 20000, { failOpen: true })
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
  // Bib search rides on THIS route rather than getting one of its own, so it inherits the
  // owner/password/reveal check and the limiter above instead of growing a second copy of both.
  // Absent = no bib filter at all; present but empty = the stats only, which is what the search
  // bar needs before anyone has typed. Capped because the only legitimate value is a few digits.
  const bibRaw = url.searchParams.get('bib')
  const bib = bibRaw === null ? undefined : bibRaw.slice(0, 32)
  const bibStats = url.searchParams.get('bibStats') === '1'
  // Counts without rows. Sent while the search box is empty, so asking how far OCR has got does
  // not drag the whole album across the wire to answer it.
  const statsOnly = url.searchParams.get('statsOnly') === '1'
  // The cheap freshness question — see lib/album-freshness.ts. Returns two numbers, no rows.
  const probe = url.searchParams.get('probe') === '1'
  const cookieStore = await cookies()

  try {
    const result = await fetchAuthorizedPhotos(albumId, cookieStore, { recentLimit, offset, limit, bib, bibStats, statsOnly, probe })
    switch (result.kind) {
      case 'invalid':
        return NextResponse.json({ error: 'Invalid album id' }, { status: 400, headers: NO_STORE })
      case 'notfound':
        return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
      case 'reveal':
        return NextResponse.json({ error: 'Locked' }, { status: 403, headers: NO_STORE })
      case 'password':
        return NextResponse.json({ error: 'Password required' }, { status: 403, headers: NO_STORE })
      case 'unavailable':
        // 503, not an empty 200. The album's tier could not be determined, so we do not know
        // whether the search should return nothing — and a guest reading "no photos" as final is
        // the worst outcome this endpoint has. The client shows "could not search" and a retry.
        return NextResponse.json({ error: 'Could not search right now' }, { status: 503, headers: NO_STORE })
      case 'ok':
        return NextResponse.json(
          probe
            // Deliberately just the two fields. Sending photos: [] alongside them would let a
            // caller that forgot to check `probe` read an empty album as a real answer.
            ? { total: result.total ?? 0, latest: result.latest ?? null }
            : { photos: result.photos, total: result.total, bibStats: result.bibStats },
          { headers: NO_STORE },
        )
    }
  } catch {
    return NextResponse.json({ error: 'Failed to load photos' }, { status: 500, headers: NO_STORE })
  }
}
