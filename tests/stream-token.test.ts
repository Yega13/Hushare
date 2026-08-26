import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A VIDEO-UPLOAD TOKEN IS CLAIMED, NOT DELETED — and three things have to stay true together.
//
// api/album/photos/create claims the token and then inserts the photo rows, in that order, with
// nothing transactional between them. When the connection dies in that gap — venue wifi, the whole
// environment this runs in — the client retries the save. With a DELETED token the retry could not
// be told apart from a stranger injecting someone else's stream uid, so the video was refused and
// the guest was asked to re-upload a clip that had already finished sending.
//
// The three invariants, and why each of them alone is not enough:
//
//   1. The claim is ATOMIC — one UPDATE ... WHERE consumed_at IS NULL RETURNING. Split it into a
//      SELECT then an UPDATE and two concurrent saves both pass the check before either writes.
//      Conflict #1 of the 2026-08-20 audit says the same thing about reordering the insert.
//   2. The retry lookup is ALBUM-SCOPED. Without .eq('album_id'), recognising "already consumed"
//      would accept any uid consumed anywhere, which is exactly the cross-album injection the
//      check was written to stop.
//   3. The relay EXCLUDES consumed tokens. Keeping the row after the claim would otherwise reopen
//      stream-relay for a video already saved — a change made in one route silently altering
//      another.
//
// These are asserted against the source because the logic lives inline in the route handlers
// around a Supabase client. That is a weaker test than a behavioural one and it is deliberate:
// weak and present beats absent. The behaviour itself was proved against the live database when
// the change was made.

const read = (rel: string) => readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8')

describe('the stream upload token survives a retried save', () => {
  it('claims the token atomically rather than deleting it', () => {
    const source = read('app/api/album/photos/create/route.ts')
    expect(
      /\.update\(\{ consumed_at:/.test(source),
      'the token must be CLAIMED (consumed_at) — a deleted row cannot tell a retry from an injection',
    ).toBe(true)
    expect(
      /\.is\('consumed_at', null\)/.test(source),
      'the claim must filter on consumed_at IS NULL, which is what makes it one-shot and atomic',
    ).toBe(true)
    expect(
      /\.from\('pending_stream_uploads'\)[\s\S]{0,120}?\.delete\(\)/.test(source),
      'photos/create must not DELETE the token — that is the behaviour this replaced',
    ).toBe(false)
  })

  it('scopes the retry lookup to this album', () => {
    const source = read('app/api/album/photos/create/route.ts')
    const lookup = /\.not\('consumed_at', 'is', null\)/.exec(source)
    expect(lookup, 'there must be a lookup for an already-consumed token (the retry path)').not.toBeNull()
    // The album filter and the TTL must both sit in the same query as that lookup. Checked over a
    // window rather than the whole file, so a .eq('album_id') belonging to some other query cannot
    // satisfy this by accident.
    const window = source.slice(Math.max(0, (lookup?.index ?? 0) - 400), (lookup?.index ?? 0) + 200)
    expect(window.includes(".eq('album_id', albumId)"), 'the retry lookup must be album-scoped').toBe(true)
    expect(window.includes('tokenTtlCutoff'), 'the retry lookup must still honour the 24h TTL').toBe(true)
  })

  it('keeps consumed tokens out of the relay', () => {
    const source = read('app/api/upload/stream-relay/[uid]/route.ts')
    expect(
      /\.is\('consumed_at', null\)/.test(source),
      'stream-relay must ignore consumed tokens, or keeping the row reopens it for a saved video',
    ).toBe(true)
  })
})
