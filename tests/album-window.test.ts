import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE SERVER-RENDERED WINDOW IS WHAT EVERY GUEST DOWNLOADS BEFORE THEY SEE ANYTHING.
//
// Measured on 2026-08-29 against a real 5,000-row album: at a window of 2000 the album page was
// 1.63 MB of HTML, on the one venue WiFi a whole finish area is sharing. At 500 it is a quarter of
// that, and nobody scrolls past 500 before the rest pages in.
//
// The two constants MUST match. The client uses its copy to decide whether to show the "load more"
// sentinel at all (total > ALBUM_FIRST_WINDOW); the server uses its copy to clamp the page size. If
// the client's is the larger of the two, it believes the album is fully loaded when it is not, and
// the sentinel never appears — the tail of a big album becomes unreachable by scrolling.
function constant(rel: string, name: string): number {
  const src = readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8')
  const marker = `${name} = `
  const at = src.indexOf(marker)
  if (at === -1) throw new Error(`${name} not found in ${rel}`)
  const rest = src.slice(at + marker.length)
  const digits = rest.slice(0, rest.search(/[^0-9_]/))
  return Number(digits.replace(/_/g, ''))
}

describe('the album first window', () => {
  const client = constant('app/[slug]/AlbumPageClient.tsx', 'ALBUM_FIRST_WINDOW')
  const server = constant('lib/server/album-access.ts', 'ALBUM_PAGE_SIZE')

  it('is the same number on both sides', () => {
    expect(client, 'client ALBUM_FIRST_WINDOW must equal server ALBUM_PAGE_SIZE').toBe(server)
  })

  it('stays small enough that a phone is not sent the whole album', () => {
    // ~825 bytes of JSON per photo row, measured across every live album. A window of 2000 is
    // 1.6 MB before anything is on screen.
    expect(server * 825, `a window of ${server} is ${Math.round(server * 825 / 1024)} KB of rows`)
      .toBeLessThanOrEqual(600 * 1024)
  })

  it('is big enough that ordinary albums never paginate at all', () => {
    // The average live album is ~212 photos and the largest real one is 1,378. Most should still
    // arrive in a single shot, exactly as before pagination existed.
    expect(server).toBeGreaterThanOrEqual(500)
  })

  it('is not what search depends on any more', () => {
    // The whole reason the window can be small: bib search runs in Postgres and face-search returns
    // its own rows. If either goes back to filtering the loaded array, a runner past the window is
    // silently told they were not photographed, and this number becomes dangerous again.
    const access = readFileSync(join(process.cwd(), 'src', 'lib', 'server', 'album-access.ts'), 'utf8')
    expect(access.includes("overlaps('bib_numbers'"), 'bib search must still run in the database').toBe(true)
    const faceSearch = readFileSync(join(process.cwd(), 'src', 'app', 'api', 'album', 'face-search', 'route.ts'), 'utf8')
    expect(faceSearch.includes('FACE_MATCH_PHOTO_COLS'), 'face-search must still return its own photo rows').toBe(true)
  })
})
