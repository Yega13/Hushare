import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'

// THE WALL RUNS ITS PHOTOS CHANNEL THROUGH lib/realtime-supervisor, like the album page.
//
// It had its own copy: a 500 ms debounce that every ping replaced, with no maximum wait, a fixed
// backoff and no fallback poll. A stream of pings -- a busy event, or anyone holding the album link,
// because the channel is public -- held the wall's refresh off for as long as it lasted (review of
// 2026-09-14), and a venue network that refuses websockets left it frozen on the projector. The rules
// are tested in tests/realtime-supervisor; this pins that the wall actually runs them, on the real
// client. Comments are stripped first.

const src = () => stripJsComments(readFileSync(join(process.cwd(), 'src', 'components', 'PhotoWall.tsx'), 'utf8'))

describe('PhotoWall hands its channel to watchPhotosChannel', () => {
  it('once, with the album topic, the changed listener, and subscribe and remove on the real client', () => {
    const text = src()
    expect(text.split('watchPhotosChannel(').length - 1, 'exactly one watch').toBe(1)
    expect(text).toMatch(/create:\s*\(onChanged\)\s*=>\s*supabase\.channel\(`album:\$\{albumId\}`\)\.on\('broadcast', \{ event: 'changed' \}, onChanged\)/)
    expect(text).toMatch(/subscribe:\s*\(ch, onStatus\)\s*=>\s*\{\s*ch\.subscribe\(onStatus\)\s*\}/)
    expect(text).toMatch(/remove:\s*\(ch\)\s*=>\s*\{\s*supabase\.removeChannel\(ch\)\s*\}/)
  })

  it('refreshes with the wall read on the wall debounce, and the effect returns the cleanup', () => {
    const text = src()
    expect(text).toMatch(/refresh:\s*\(\)\s*=>\s*\{\s*void refetch\(\)\s*\}/)
    expect(text).toMatch(/now:\s*\(\)\s*=>\s*Date\.now\(\)/)
    expect(text).toMatch(/debounceMs:\s*WALL_REFETCH_DEBOUNCE_MS\b/)
    expect(text).toMatch(/const WALL_REFETCH_DEBOUNCE_MS = 500\b/)
    expect(text).toMatch(/return watchPhotosChannel\(/)
  })

  it('keeps no debounce, reconnect or subscribe of its own', () => {
    const text = src()
    expect(text).not.toMatch(/clearTimeout\(debounce\)|retryTimer|2 \*\* retry/)
    expect(text, 'the only subscribe is the one handed to the port').not.toMatch(/\.subscribe\(\(status/)
  })
})
