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

const cfg: {
  album: Record<string, unknown> | null
  albumError: boolean
  /**
   * What album_video_seconds answers. A NUMBER, because the sum now happens in SQL.
   *
   * It used to be a list of rows this file added up itself, and the clamp that made a poisoned row
   * harmless ran in TypeScript where a test could watch it. That clamp is inside the SQL now, and a
   * mock cannot execute SQL — so re-implementing it here would only prove the mock (rule 17). The
   * clamp is held to the TypeScript constant by tests/album-video-seconds.test.ts, which reads the
   * migration; what these tests own is everything AROUND the number.
   */
  videoSecondsUsed: unknown
  durationError: string | null
  /** Every rpc(name, args) the module made. */
  rpcCalls: Array<{ name: string; args: unknown }>
  gateOk: boolean
  albumRlOk: boolean
  tier: string
  tierThrows: boolean
  rateLimitCalls: unknown[][]
  reports: unknown[][]
  /** What the ALBUM lookup was filtered on, as `eq:col` / `is:col`. */
  albumFilters: Record<string, unknown>
  /** The album row signedInUserForGate was asked about, once per call. */
  signedInLookups: unknown[]
  /** What the signed-in lookup answers. A real id, so dropping it is visible. */
  signedInUserId: string | null
  gateCalls: Array<{ albumId: string | undefined; signedInUserId: string | null | undefined }>
} = {
  album: null, albumError: false, videoSecondsUsed: 0, durationError: null, rpcCalls: [],
  gateOk: true, albumRlOk: true, tier: 'free', tierThrows: false,
  rateLimitCalls: [], reports: [],
  albumFilters: {}, signedInLookups: [], signedInUserId: 'signed-in-account-id', gateCalls: [],
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'albums') {
        // RECORDS ITS FILTERS, like the photos chain below already did. Ignoring them meant
        // `.is('retired_at', null)` could name any column at all and every test still passed, while
        // a retired album — retention expired, media queued for deletion — went on reserving
        // Cloudflare Stream quota that nobody is paying for.
        return {
          select: () => ({
            eq: (col: string, val: unknown) => {
              cfg.albumFilters[`eq:${col}`] = val
              return {
                is: (col2: string, val2: unknown) => {
                  cfg.albumFilters[`is:${col2}`] = val2
                  return {
                    maybeSingle: async () =>
                      (cfg.albumError ? { data: null, error: { message: 'boom' } } : { data: cfg.album, error: null }),
                  }
                },
              }
            },
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
    // THE DURATION SUM, WHICH IS A DATABASE FUNCTION NOW. Records the call so a test can assert the
    // module asks for THIS album's total by name — a wrong function name or a wrong argument key
    // returns an error from PostgREST, which fails open, which is the budget silently not applying.
    rpc: (name: string, args: unknown) => {
      cfg.rpcCalls.push({ name, args })
      return {
        returns: async () => (cfg.durationError
          ? { data: null, error: { message: cfg.durationError } }
          : { data: cfg.videoSecondsUsed, error: null }),
      }
    },
  }),
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/rate-limit', () => ({
  // RECORDS ITS ARGUMENTS. Ignoring them meant the key, the window, the ceiling and the fail
  // direction could all be changed at once and every test still passed.
  checkRateLimit: async (...args: unknown[]) => {
    cfg.rateLimitCalls.push(args)
    return cfg.albumRlOk ? { ok: true } : { ok: false, retryAfterSeconds: 60 }
  },
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
    // BOTH RECORD. signedInUserForGate answered null here, which is exactly what the gate assumes
    // when nobody asks — so deleting the lookup, or dropping the gate's third argument, was
    // invisible to every test in this file. That argument is what lets an album's own owner upload
    // from a tab that never received the owner cookie (rule 25).
    gateAllowsContribution: async (album: { id: string }, _cookies: unknown, signedInUserId?: string | null) => {
      cfg.gateCalls.push({ albumId: album?.id, signedInUserId })
      return cfg.gateOk ? { ok: true } : { ok: false, error: 'Enter the album password before adding photos' }
    },
    signedInUserForGate: async (album: unknown) => {
      cfg.signedInLookups.push(album)
      return cfg.signedInUserId
    },
  }
})
// RECORDS ITS CALLS. The fail-open branch's report is the ONLY signal that the video budget has
// stopped being enforced, and a no-op mock meant deleting it changed nothing anywhere.
vi.mock('@/lib/report-server-error', () => ({
  reportServerError: (...args: unknown[]) => { cfg.reports.push(args) },
}))

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
  cfg.videoSecondsUsed = 0
  cfg.durationError = null
  cfg.rpcCalls = []
  cfg.gateOk = true
  cfg.albumRlOk = true
  cfg.tier = 'free'
  cfg.tierThrows = false
  cfg.rateLimitCalls = []
  cfg.reports = []
  cfg.albumFilters = {}
  cfg.signedInLookups = []
  cfg.signedInUserId = 'signed-in-account-id'
  cfg.gateCalls = []
})

describe('the album minute pool is actually enforced', () => {
  it('refuses a clip the album has no room for, with 403', async () => {
    // THE MUTATION THAT SURVIVED EVERYTHING: replacing this check with `if (false)`.
    cfg.videoSecondsUsed = 595                            // free budget is 600s
    const res = await authorizeVideoUpload(req({ durationSeconds: 30 }))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.response.status).toBe(403)
    const body = await res.response.json() as { code?: string; error?: string }
    expect(body.code).toBe('album_video_full')
  })

  it('allows a clip that exactly fills the remaining budget', async () => {
    cfg.videoSecondsUsed = 570
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
    cfg.videoSecondsUsed = 599
    const res = await authorizeVideoUpload(req({ durationSeconds: 5 }))
    expect(res.ok, 'a 5s clip into a 599/600s album must be refused').toBe(false)
  })

  it('asks the database for THIS album total, by name', async () => {
    // The sum moved into SQL, so what this module still owns is asking the right question. A wrong
    // function name or a wrong argument key comes back as a PostgREST error, which fails open — the
    // budget silently not applying, which is the exact outcome the whole module exists to prevent.
    await authorizeVideoUpload(req())
    expect(cfg.rpcCalls).toHaveLength(1)
    expect(cfg.rpcCalls[0].name).toBe('album_video_seconds')
    expect(cfg.rpcCalls[0].args).toEqual({ p_album_id: ALBUM_ID })
  })

  it('does not read a single duration row over the network', async () => {
    // The point of the move. It used to pull up to 1,000 rows on the hot path of every video upload
    // to produce one number — and past 1,000 rows the number was drawn from an arbitrary subset and
    // read LOW, so the budget stopped binding on Pro and Max albums, which are the paid ones.
    // The admin mock throws on any table access, so a reintroduced query fails loudly here.
    await expect(authorizeVideoUpload(req())).resolves.toBeTruthy()
  })

  it('a total it cannot trust is reported, not read as an empty album', async () => {
    // A bigint that arrives as null, a string, or a negative means the budget is NOT being
    // enforced. Treating it as "0 seconds used" would let everything through while looking
    // perfectly healthy — a negative you cannot back up (rule 20). It fails open like every other
    // counted limit here, but it says so.
    for (const bad of [null, undefined, -5, Number.NaN, 'not a number']) {
      cfg.rpcCalls = []
      cfg.reports = []
      cfg.videoSecondsUsed = bad
      const res = await authorizeVideoUpload(req({ durationSeconds: 30 }))
      expect(res.ok, `${String(bad)} must not block the upload`).toBe(true)
      expect(cfg.reports, `${String(bad)} must reach the panel`).toHaveLength(1)
      expect(String(cfg.reports[0][1])).toContain('NOT enforced')
    }
  })

  it('a bigint that arrives as a numeric STRING is still enforced', async () => {
    // Postgres bigint is returned as a string by several drivers. Refusing to read it would fail
    // open on every single upload — the budget gone platform-wide, silently.
    cfg.videoSecondsUsed = '595'
    const res = await authorizeVideoUpload(req({ durationSeconds: 30 }))
    expect(res.ok, '595 + 30 is over the 600s free budget').toBe(false)
    if (res.ok) return
    expect(res.response.status).toBe(403)
    expect(cfg.reports, 'a readable total is not an incident').toHaveLength(0)
  })

  it('the refusal is recognised as deliberate, and is NOT retried', async () => {
    // Two harms if this drifts: the refusal lands in the admin Errors tab, and upload-policy
    // treating it as retryable would re-run the whole route four more times for a refusal that is
    // permanent until somebody deletes a video. Both sides imported, nothing retyped (rule 17).
    cfg.videoSecondsUsed = 600
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
    // AND IT SAYS SO. This report is the only signal that the budget stopped being enforced; the
    // module's own comment promises it "belongs in the panel, not only in a log nobody reads".
    // Deleting it used to change nothing observable.
    expect(cfg.reports, 'a silently unenforced budget is the worst version of this').toHaveLength(1)
    expect(String(cfg.reports[0][1])).toContain('Video budget NOT enforced')
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

  it('refuses for the FIRST reason, not the last — the order is the contract', async () => {
    // The docstring says "ORDER IS PART OF THE CONTRACT" and nothing held it: moving the gate check
    // to the end left every check running and every test passing. But a guest with a wrong password
    // on a full album would then be told "This album is out of video time" — a true statement about
    // a rule they are not breaking, and one they cannot act on. They would go and delete videos.
    cfg.gateOk = false
    cfg.videoSecondsUsed = 600                       // also full, so both refusals are available
    const res = await authorizeVideoUpload(req())
    expect(res.ok).toBe(false)
    if (res.ok) return
    const body = await res.response.json() as { error: string }
    expect(body.error).toBe('Enter the album password before adding photos')
  })

  it('429s a hammered album, WITH a Retry-After', async () => {
    cfg.albumRlOk = false
    const res = await authorizeVideoUpload(req())
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.response.status).toBe(429)
    expect(res.response.headers.get('Retry-After')).toBe('60')
  })

  it('limits the RIGHT thing, by the right amount, in the right direction', async () => {
    // All four of these were changed at once in a mutation and every test still passed, because the
    // mock ignored its arguments. Each one is a different live failure:
    //   key     — a shared key would let one busy album exhaust the budget for every album
    //   window  — a shorter window turns an abuse backstop into a participation cap at an event
    //   ceiling — same
    //   failOpen: false — the deliberate choice that a limiter we cannot consult REFUSES, matching
    //             presign_album on the image path. Flipping it open makes a database blip a free
    //             pass on the only path that bounds Stream cost.
    await authorizeVideoUpload(req())
    expect(cfg.rateLimitCalls).toHaveLength(1)
    expect(cfg.rateLimitCalls[0]).toEqual([`stream_album:${ALBUM_ID}`, 3600, 4000, { failOpen: false }])
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
    cfg.videoSecondsUsed = 570
    const res = await authorizeVideoUpload(req({ durationSeconds: 60 }))
    expect(res.ok).toBe(false)
    if (res.ok) return
    const body = await res.response.json() as { error: string }
    // Compared against the real generator rather than a copy of its wording.
    expect(body.error).toBe(videoAlbumFullMessage(videoCaps('free'), 570))
  })
})

describe('the album it authorizes is the album it looked up', () => {
  it('filters on this album id AND on the album not being retired', async () => {
    // Both filters were invisible here: this mock ignored its arguments while the photos chain right
    // beside it recorded them. A retired album is one whose retention ran out and whose media is
    // queued for deletion — it must never reserve new Cloudflare Stream quota.
    await authorizeVideoUpload(req({ durationSeconds: 30 }))
    expect(cfg.albumFilters['eq:id']).toBe(ALBUM_ID)
    expect(cfg.albumFilters).toHaveProperty('is:retired_at')
    expect(cfg.albumFilters['is:retired_at']).toBeNull()
  })
})

describe('the signed-in owner is recognized on a device with no owner cookie', () => {
  it('asks who is signed in, about THIS album, and hands the answer to the gate', async () => {
    // The account is stronger proof than the owner cookie, which only proves possession of a link
    // meant to be shareable. Passing it is what stops an owner being asked for a password on their
    // own album from a tab that never received the cookie.
    await authorizeVideoUpload(req({ durationSeconds: 30 }))
    expect(cfg.signedInLookups, 'the signed-in account must be looked up').toHaveLength(1)
    expect(cfg.signedInLookups[0]).toMatchObject({ id: ALBUM_ID })
    expect(cfg.gateCalls).toHaveLength(1)
    expect(cfg.gateCalls[0].signedInUserId, 'the gate must receive the account id').toBe('signed-in-account-id')
  })

  it('passes null through unchanged when nobody is signed in', async () => {
    cfg.signedInUserId = null
    await authorizeVideoUpload(req({ durationSeconds: 30 }))
    expect(cfg.gateCalls[0].signedInUserId).toBeNull()
  })

  it('gates the album it was asked about', async () => {
    await authorizeVideoUpload(req({ durationSeconds: 30 }))
    expect(cfg.gateCalls[0].albumId).toBe(ALBUM_ID)
  })
})
