import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { fetchAuthorizedPhotos } from '@/lib/server/album-access'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Thin wrapper over the shared fetchAuthorizedPhotos() (src/lib/server/album-access.ts), also used
// by the server-rendered album page so the owner/password/reveal checks can never drift apart.
export async function GET(req: Request) {
  const albumId = new URL(req.url).searchParams.get('albumId') ?? ''
  const cookieStore = await cookies()

  try {
    const result = await fetchAuthorizedPhotos(albumId, cookieStore)
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
        return NextResponse.json({ photos: result.photos }, { headers: NO_STORE })
    }
  } catch {
    return NextResponse.json({ error: 'Failed to load photos' }, { status: 500, headers: NO_STORE })
  }
}
