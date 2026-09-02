import { describe, it, expect, vi, beforeEach } from 'vitest'

// THE ONLY THING BOUNDING VIDEO COST, FINALLY TESTED.
//
// Five mutations to this logic survived the entire 901-test suite while it lived inline in
// /api/upload/stream. The two worst:
//
//   * the whole budget check replaced with `if (false)` — every video uploads, no limit at all
//   * the Cloudflare reservation hardcoded to 60 seconds — every video over a minute uploads
//     completely over venue wifi and then dies at 100% during processing, which this repo records
//     as its worst video bug
//
// The pure functions underneath scored 12 of 12 against the same mutations. They were never the
// problem: the decision had been extracted and tested while the ENFORCEMENT stayed in a route
// handler where nothing could observe it (rule 15).
//
// It matters more here than anywhere else on the upload path because there is no second line of
// defence: /api/album/photos/create writes duration_seconds and checks no budget at all. Stream
// bills per MINUTE STORED regardless of bytes, against a PURCHASED account ceiling whose
// exhaustion makes video fail for every album at once.
//
// The database, cookies, rate limiter and tier lookup are mocked at the module boundary. The
// budget arithmetic, the ordering of the checks, the status codes and the reservation are real.

type PhotoRow = { duration_seconds: number | null }

const cfg: {
  album: Record<string, unknown> | null
  albumError: boolean
  durations: PhotoRow[]
  durationError: string | null
  /** Records what the duration query was actually filtered on. */
  durationFilters: Record<string, unknown>
  gateOk: boolean
  albumRlOk: boolean
  tier: string
  tierThrows: boolean
} = {
  album: null, albumError: false, durations: [], durationError: null, durationFilters: {},
  gateOk: true, albumRlOk: true, tier: 'free', tierThrows: false,
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'albums') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () =>
                  (cfg.albumError ? { data: null, error: { message: 'boom' } } : { data: cfg.album, error: null }),
              }),
            }),
          }),
        }
      }
      // photos — the duration sum. A chain that RECORDS its filters, so a test can assert the
      // media_type filter is still there rather than trusting the source text.
      return {
        select: () => {
          const chain: Record<string, unknown> = {}
          chain.eq = (col: string, val: unknown) => { cfg.durationFilters[col] = val; return chain }
          chain.limit = (n: number) => { cfg.durationFilters.__limit = n; return chain }
          chain.returns = async () =>
            (cfg.durationError ? { data: null, error: { message: cfg.durationError } } : { data: cfg.durations, error: null })
          return chain
        },
      }
    },
  }),
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => (cfg.albumRlOk ? { ok: true } : { ok: false, retryAfterSeconds: 60 }),
  clientIpKey: () => 'test-key',
}))
vi.mock('@/lib/subscriptions', () => ({
  getUserTierById: async () => {
    if (cfg.tierThrows) throw new Error('tier lookup down')
    return cfg.tier
  },
}))
vi.mock('@/lib/server/album-access', async (orig) => {
  const actual = await orig() as Record<string, unknown>
  return {
    ...actual,
    gateAllowsContribution: async () => (cfg.gateOk ? { ok: true } : { ok: false, error: 'Enter the album password before adding photos' }),
    signedInUserForGate: async () => null,
  }
})
vi.mock('@/lib/report-server-error', () => ({ reportServerError: () => {} }))

import { authorizeVideoUpload } from '@/lib/server/video-upload-authorization'
import { videoCaps, videoAlbumFullMessage } from '@/lib/album-entitlements'
import { resolveMaxDurationSeconds } from '@/lib/stream-duration'
import { isExpectedRefusal, verdictForResponse } from '@/lib/upload-policy'

const ALBUM_ID = '11111111-2222-3333-4444-555555555555'
const OK_ALBUM = {
  id: ALBUM_ID, user_id: null, guest_uploads_enabled: true,
  package_tier: null, package_expires_at: null,
  owner_token: 'tok', password_hash: null, reveal_at: null,
}

/** A well-formed request that should be allowed unless a test says otherwise. */
function req(over: Partial<{ contentType: string; fileSize: number; durationSeconds: unknown }> = {}) {
  return {
    albumId: ALBUM_ID,
    contentType: 'video/mp4',
    fileSize: 5 * 1024 * 1024,
    durationSeconds: 30,
    ...over,
  }
}

beforeEach(() => {
  cfg.album = { ...OK_ALBUM }
  cfg.albumError = false
  cfg.durations = []
  cfg.durationError = null
  cfg.durationFilters = {}
  cfg.gateOk = true
  cfg.albumRlOk = true
  cfg.tier = 'free'
  cfg.tierThrows = false
})

describe('the album minute pool is actually enforced', () => {
  it('refuses a clip the album has no room for, with 403', async () => {
    // THE MUTATION THAT SURVIVED EVERYTHING: replacing this check with `if (false)`.
    cfg.durations = [{ duration_seconds: 595 }]           // free budget is 600s
    const res = await authorizeVideoUpload(req({ durationSeconds: 30 }))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.response.status).toBe(403)
    const body = await res.response.json() as { code?: string; error?: string }
    expect(body.code).toBe('album_video_full')
  })

  it('allows a clip that exactly fills the remaining budget', async () => {
    cfg.durations = [{ duration_seconds: 570 }]
    const res = await authorizeVideoUpload(req({ durationSeconds: 30 }))
    expect(res.ok).toBe(true)
  })

  it('lets ONE video use the entire budget, which is the point of removing the clip cap', async () => {
    const res = await authorizeVideoUpload(req({ durationSeconds: videoCaps('free').maxTotalSeconds }))
    expect(res.ok).toBe(true)
  })

  it('asks the budget about THIS clip, not about zero', async () => {
    // A mutation passed 0 as the clip length. The album then never fills, because adding nothing
    // never exceeds anything — every upload is approved forever.
    cfg.durations = [{ duration_seconds: 599 }]
    const res = await authorizeVideoUpload(req({ durationSeconds: 5 }))
    expect(res.ok, 'a 5s clip into a 599/600s album must be refused').toBe(false)
  })

  it('sums only VIDEO rows, and the filter is what keeps the limit real', async () => {
    // Photo rows carry a NULL duration, so dropping .eq('media_type','video') does not change the
    // arithmetic — it changes which 1,000 rows come back. Past 1,000 items they would be
    // overwhelmingly photos, the sum would read 0, and the budget would silently stop existing on
    // exactly the largest albums. Asserted against the recorded chain, not the source text.
    await authorizeVideoUpload(req())
    expect(cfg.durationFilters.media_type).toBe('video')
    expect(cfg.durationFilters.album_id).toBe(ALBUM_ID)
  })

  it('the refusal is recognised as deliberate, and is NOT retried', async () => {
    // Two harms if this drifts: the refusal lands in the admin Errors tab, and upload-policy
    // treating it as retryable would re-run the whole route four more times for a refusal that is
    // permanent until somebody deletes a video. Both sides imported, nothing retyped (rule 17).
    cfg.durations = [{ duration_seconds: 600 }]
    const res = await authorizeVideoUpload(req())
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.response.status).toBe(403)
    const body = await res.response.json() as { error: string }
    expect(isExpectedRefusal(body.error)).toBe(true)
    expect(verdictForResponse({
      status: res.response.status, serverErrorsSoFar: 0, maxServerErrors: 4, withinDeadline: true,
    })).not.toBe('retry')
  })

  it('fails OPEN when the duration sum cannot be read', async () => {
    // Rule 19, stated: a total we could not read must not refuse a guest at a live event. It costs
    // minutes; refusing everybody costs the event. The caller reports it to the admin panel.
    cfg.durationError = 'connection reset'
    const res = await authorizeVideoUpload(req({ durationSeconds: 99999 }))
    expect(res.ok).toBe(true)
  })
})

describe('what Cloudflare is told to reserve', () => {
  it('is the value resolveMaxDurationSeconds returns, never a hardcoded one', async () => {
    // THE MUTATION THAT KILLS UPLOADS AT 100%. Hardcoding 60 here passed all 901 tests. Imported
    // rather than recomputed, so the test cannot drift into agreeing with a wrong implementation
    // (rule 17).
    // All inside the free 600s budget, so the only thing under test is the reservation — a value
    // that exceeded the budget would be refused first and prove nothing about it.
    for (const d of [5, 30, 120, 599, 600]) {
      const res = await authorizeVideoUpload(req({ durationSeconds: d }))
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.maxDurationSeconds, `duration ${d}`).toBe(resolveMaxDurationSeconds(d))
    }
  })

  it('is ALWAYS greater than the clip it is for, across the whole approvable range', async () => {
    // The property the 100% bug comes from. The largest approvable clip is now the whole budget,
    // so that is the value most likely to be clamped by a future "optimisation".
    for (const tier of ['free', 'pro', 'studio'] as const) {
      cfg.tier = tier
      cfg.album = { ...OK_ALBUM, user_id: 'user-1' }
      const longest = videoCaps(tier).maxTotalSeconds
      const res = await authorizeVideoUpload(req({ durationSeconds: longest, fileSize: 1024 }))
      expect(res.ok, tier).toBe(true)
      if (!res.ok) return
      expect(res.maxDurationSeconds, tier).toBeGreaterThan(longest)
    }
  })

  it('falls back generously when the clip could not be measured', async () => {
    const res = await authorizeVideoUpload(req({ durationSeconds: undefined }))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.maxDurationSeconds).toBe(resolveMaxDurationSeconds(undefined))
  })
})

describe('the guards in front of the budget, in order', () => {
  it('refuses a type that is not video, before touching the database', async () => {
    const res = await authorizeVideoUpload(req({ contentType: 'image/jpeg' }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(415)
  })

  it('refuses a file above the absolute ceiling', async () => {
    const res = await authorizeVideoUpload(req({ fileSize: 99 * 1024 * 1024 * 1024 }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(413)
  })

  it('refuses a file above THIS album tier cap', async () => {
    // Free is far below the studio hard cap, so this can only be the per-tier check.
    const res = await authorizeVideoUpload(req({ fileSize: 900 * 1024 * 1024 }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(413)
  })

  it('404s a missing or retired album', async () => {
    cfg.album = null
    const res = await authorizeVideoUpload(req())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(404)
  })

  it('refuses when guest uploads are switched off', async () => {
    cfg.album = { ...OK_ALBUM, guest_uploads_enabled: false }
    const res = await authorizeVideoUpload(req())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(403)
  })

  it('honours the password/reveal gate — contributing is gated, not just viewing', async () => {
    cfg.gateOk = false
    const res = await authorizeVideoUpload(req())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(403)
  })

  it('429s a hammered album, WITH a Retry-After', async () => {
    cfg.albumRlOk = false
    const res = await authorizeVideoUpload(req())
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.response.status).toBe(429)
    expect(res.response.headers.get('Retry-After')).toBe('60')
  })

  it('503s rather than guessing when the tier lookup is down', async () => {
    // Erring toward "unavailable" instead of toward 'free' matters: free has the smallest budget,
    // so guessing would refuse a paying album's upload during an outage.
    cfg.album = { ...OK_ALBUM, user_id: 'user-1' }
    cfg.tierThrows = true
    const res = await authorizeVideoUpload(req())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(503)
  })
})

describe('a package raises the album budget, not just the owner plan', () => {
  it('gives an anonymous album with a Max package the studio budget', async () => {
    // Without this an album sold a Max Package would refuse the long video it was sold with.
    cfg.album = {
      ...OK_ALBUM,
      package_tier: 'studio',
      package_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }
    const res = await authorizeVideoUpload(req({ durationSeconds: videoCaps('studio').maxTotalSeconds, fileSize: 1024 }))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.effectiveTier).toBe('studio')
  })

  it('an EXPIRED package does not', async () => {
    cfg.album = {
      ...OK_ALBUM,
      package_tier: 'studio',
      package_expires_at: new Date(Date.now() - 86_400_000).toISOString(),
    }
    const res = await authorizeVideoUpload(req({ durationSeconds: videoCaps('studio').maxTotalSeconds, fileSize: 1024 }))
    expect(res.ok, 'an expired package must not buy the studio budget').toBe(false)
  })
})

describe('the refusal message is one a guest can act on', () => {
  it('names the total and what is left', async () => {
    cfg.durations = [{ duration_seconds: 570 }]
    const res = await authorizeVideoUpload(req({ durationSeconds: 60 }))
    expect(res.ok).toBe(false)
    if (res.ok) return
    const body = await res.response.json() as { error: string }
    // Compared against the real generator rather than a copy of its wording.
    expect(body.error).toBe(videoAlbumFullMessage(videoCaps('free'), 570))
  })
})
