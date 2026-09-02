import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// THE ALARM ITSELF — the one route whose failure mode is silence.
//
// Everything on /admin is a number somebody has to go and look at. This cron is what turns the
// dashboard into an alarm, so every defect in it is invisible by construction: nothing throws,
// nothing appears in the panel, and the way you find out is that an incident came and went and no
// email arrived.
//
// The DECISIONS were extracted into lib/error-alert-grouping and are tested there — the threshold,
// the cooldown, the hourly ceiling, the signature rule, the tallies. What lives here is the WIRING,
// and the wiring is where the last three fixes went (rule 15):
//
//   * clearTimeout on the enrichment race — without it a timer still fires on a run that already
//     succeeded, printing "enrichment timed out — sending without it" four seconds after an email
//     that went perfectly. A log line describing something that did not happen is what somebody
//     reads at 3am while deciding whether to trust the alert (rule 20).
//   * giving the hourly slot back when the send fails — the cooldown is claimed BEFORE sending on
//     purpose, but counting a send that never left means four failures while Resend is down spend
//     the entire hour: `hourly-cap` for sixty minutes with zero emails delivered, at exactly the
//     moment something is wrong enough to be alerting.
//   * the album block being sent at all, with the tallies the grouping module produced.
//
// The database, the mailer and the owner lookup are mocked at the module boundary. The ordering,
// the claim, the rollback and the timer are real.

type Upsert = { key: string; value: string }

const cfg: {
  rows: Array<{ album_id: string | null; message: string; source: string; ua: string | null; context: { repeats?: number } | null }>
  queryError: string | null
  state: string | null
  /** The created_at lower bound the query actually used. */
  since: string | null
  /** The row cap the query actually used. */
  sampleLimit: number | null
  /** Makes the state READ fail. Every bound this route has lives in that row. */
  stateReadError: string | null
  sendThrows: boolean
  /** Index of the first upsert that should THROW (network-class failure). null = never. */
  failUpsertsAfter: number | null
  /** Index of the first upsert that should return { error } (PostgREST-class failure). */
  upsertErrorFrom: number | null
  enrichDelayMs: number
  enrichThrows: boolean
  upserts: Upsert[]
  sent: unknown[]
  logs: string[]
} = {
  rows: [], queryError: null, state: null, since: null, sampleLimit: null, stateReadError: null, sendThrows: false, failUpsertsAfter: null, upsertErrorFrom: null,
  enrichDelayMs: 0, enrichThrows: false, upserts: [], sent: [], logs: [],
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'error_events') {
        const chain: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'order']) chain[m] = () => chain
        // gte and limit RECORD. The window the query looks back over is the number the email is
        // supposed to name, and the limit is what decides whether the count is a total or a floor.
        chain.gte = (_col: string, value: string) => { cfg.since = value; return chain }
        chain.limit = (n: number) => { cfg.sampleLimit = n; return chain }
        chain.returns = async () => (cfg.queryError
          ? { data: null, error: { message: cfg.queryError } }
          : { data: cfg.rows, error: null })
        return chain
      }
      // system_state — the cooldown claim and the rollback.
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => (cfg.stateReadError
          ? { data: null, error: { message: cfg.stateReadError } }
          : { data: cfg.state === null ? null : { value: cfg.state }, error: null }) }) }),
        upsert: async (row: Upsert) => {
          const i = cfg.upserts.length
          cfg.upserts.push(row)
          // The two ways a write fails are genuinely different and the route must handle both: a
          // PostgREST rejection RETURNS { error }, a network failure THROWS.
          if (cfg.failUpsertsAfter !== null && i >= cfg.failUpsertsAfter) throw new Error('state write failed')
          if (cfg.upsertErrorFrom !== null && i >= cfg.upsertErrorFrom) return { error: { message: 'row is read only' } }
          return { error: null }
        },
      }
    },
  }),
}))

vi.mock('@/lib/email', () => ({
  sendErrorSpikeEmail: async (to: string, payload: unknown) => {
    if (cfg.sendThrows) throw new Error('resend is down')
    cfg.sent.push({ to, payload })
  },
}))

vi.mock('@/lib/server/error-attribution', () => ({
  attachAlbumOwners: async (_admin: unknown, tallies: Array<{ album_id: string | null; count: number }>) => {
    if (cfg.enrichThrows) throw new Error('owner lookup exploded')
    if (cfg.enrichDelayMs > 0) await new Promise((r) => setTimeout(r, cfg.enrichDelayMs))
    return tallies.map((t) => ({ ...t, album: { title: 'Anna & David', slug: 'annadavid', email: 'anna@example.com' } }))
  },
}))

const { POST } = await import('@/app/api/cron/error-alert/route')
const { MAX_ALERTS_PER_HOUR } = await import('@/lib/error-alert-grouping')

const SECRET = 'test-cron-secret'

/** Enough distinct failures to clear the threshold with room to spare. */
function spike(n = 20, albumId: string | null = 'album-1') {
  return Array.from({ length: n }, (_, i) => ({
    album_id: albumId, message: 'upload failed', source: 'upload',
    ua: `Mozilla/5.0 (device-${i % 3})`, context: null,
  }))
}

function post(secret = SECRET) {
  return new Request('https://hushare.space/api/cron/error-alert', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  })
}

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  process.env.ALBUM_RETIREMENT_SECRET = SECRET
  process.env.ERROR_ALERT_EMAIL = 'admin@hushare.space'
  cfg.rows = spike()
  cfg.queryError = null
  cfg.state = null
  cfg.since = null
  cfg.sampleLimit = null
  cfg.stateReadError = null
  cfg.sendThrows = false
  cfg.failUpsertsAfter = null
  cfg.upsertErrorFrom = null
  cfg.enrichDelayMs = 0
  cfg.enrichThrows = false
  cfg.upserts = []
  cfg.sent = []
  cfg.logs = []
  errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    cfg.logs.push(args.map(String).join(' '))
  })
})

afterEach(() => {
  errorSpy.mockRestore()
  vi.useRealTimers()
})

describe('only the scheduler can fire the alarm', () => {
  it('refuses a request with the wrong secret, before any query', async () => {
    const res = await POST(post('not-the-secret'))
    expect(res.status).toBe(403)
    expect(cfg.upserts).toHaveLength(0)
    expect(cfg.sent).toHaveLength(0)
  })

  it('refuses a request with no Authorization header at all', async () => {
    const res = await POST(new Request('https://hushare.space/api/cron/error-alert', { method: 'POST' }))
    expect(res.status).toBe(403)
  })

  it('does nothing when there is nowhere to send', async () => {
    delete process.env.ERROR_ALERT_EMAIL
    const res = await POST(post())
    expect(res.status).toBe(200)
    expect(cfg.sent).toHaveLength(0)
    expect(cfg.upserts, 'a skipped run must not claim the cooldown').toHaveLength(0)
  })
})

describe('an ordinary spike sends one email, naming the albums', () => {
  it('claims the cooldown BEFORE sending, then sends', async () => {
    // The order is deliberate. Claiming after would mean a failed write makes every subsequent tick
    // send again — a mail loop during an incident, which is the failure that actually hurts.
    const res = await POST(post())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ alerted: true })
    expect(cfg.upserts).toHaveLength(1)
    expect(cfg.sent).toHaveLength(1)
  })

  it('sends the album block the grouping module produced', async () => {
    // album_id is what turns "20 things failed" into something anyone can act on. It was in the
    // table all along and simply never selected.
    await POST(post())
    const { payload } = cfg.sent[0] as { payload: { albums: Array<{ slug: string; count: number }>; count: number } }
    expect(payload.count).toBe(20)
    expect(payload.albums).toHaveLength(1)
    expect(payload.albums[0]).toMatchObject({ slug: 'annadavid', count: 20 })
  })

  it('stays quiet below the threshold', async () => {
    // One guest on a dying connection is not an incident.
    cfg.rows = spike(3)
    const res = await POST(post())
    expect(await res.json()).toMatchObject({ alerted: false })
    expect(cfg.sent).toHaveLength(0)
    expect(cfg.upserts, 'not sending must not consume the hourly slot').toHaveLength(0)
  })

  it('reports a failed query instead of alerting on nothing', async () => {
    cfg.queryError = 'connection reset'
    const res = await POST(post())
    expect(res.status).toBe(500)
    expect(cfg.sent).toHaveLength(0)
  })
})

describe('the enrichment race is cleaned up after itself', () => {
  it('does not print a timeout for a run that already succeeded', async () => {
    // THE BUG THIS FIXES. Without clearTimeout the 4s timer still fires on a successful run, so the
    // log grows a line saying enrichment timed out and the alert was sent without it — four seconds
    // after an email that had the album block in it. Somebody reads that at 3am.
    vi.useFakeTimers()
    const p = POST(post())
    await vi.runOnlyPendingTimersAsync()
    await p
    // Push well past the 4s bound. A leaked timer fires here.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(cfg.logs.filter((l) => l.includes('timed out')), cfg.logs.join(' | ')).toEqual([])
    expect(cfg.sent).toHaveLength(1)
  })

  it('gives up on a SLOW owner lookup and sends anyway', async () => {
    // THE TIMER'S JOB, which nothing tested. Only its cleanup was covered, so replacing the whole
    // Promise.race with a bare `await attachAlbumOwners(...).catch(() => unresolved)` passed all
    // thirteen tests here — and that is the failure the race exists to prevent: getUserById takes
    // no AbortSignal, so a hung lookup means the tick claims the cooldown, waits forever, sends
    // nothing, and the next 59 ticks are suppressed. An hour of silence during an incident.
    //
    // cfg.enrichDelayMs was declared, reset and read by the mock, and NEVER SET by any test.
    vi.useFakeTimers()
    cfg.enrichDelayMs = 30_000
    const p = POST(post())
    // Past the 4s bound but nowhere near the lookup's 30s.
    await vi.advanceTimersByTimeAsync(5_000)
    const res = await p

    expect(await res.json(), 'the alarm must still fire').toMatchObject({ alerted: true })
    expect(cfg.sent, 'losing the album block is the small loss; losing the alarm is the big one').toHaveLength(1)
    const { payload } = cfg.sent[0] as { payload: { lookupFailed: boolean; albums: unknown[] } }
    expect(payload.lookupFailed, 'the email must say the block is missing, not imply no albums').toBe(true)
    expect(cfg.logs.some((l) => l.includes('timed out'))).toBe(true)
  })

  it('still sends when the owner lookup fails outright', async () => {
    // Losing the album block is a small loss; losing the alarm is the one that matters (rule 19).
    cfg.enrichThrows = true
    const res = await POST(post())
    expect(await res.json()).toMatchObject({ alerted: true })
    expect(cfg.sent).toHaveLength(1)
    const { payload } = cfg.sent[0] as { payload: { lookupFailed: boolean } }
    expect(payload.lookupFailed, 'the email must say the lookup failed rather than imply no albums').toBe(true)
  })
})

describe('a send that never left does not spend the hour', () => {
  it('gives the hourly slot back when the mailer throws', async () => {
    // Four failures while Resend is down would otherwise burn the whole hourly ceiling: `hourly-cap`
    // for the next sixty minutes with zero emails delivered, at exactly the moment something is
    // wrong enough to be alerting.
    cfg.sendThrows = true
    const res = await POST(post())
    expect(await res.json()).toMatchObject({ alerted: false, reason: 'send failed' })
    expect(cfg.upserts).toHaveLength(2)

    const claimed = JSON.parse(cfg.upserts[0].value) as { sentThisHour: number; signature: string; sentAt: string }
    const rolled = JSON.parse(cfg.upserts[1].value) as { sentThisHour: number; signature: string; sentAt: string }
    expect(claimed.sentThisHour).toBe(1)
    expect(rolled.sentThisHour, 'the counter goes back').toBe(0)
    // sentAt and the signature STAY — those are what stop a retry storm on the same incident. Only
    // the counter is rolled back.
    expect(rolled.signature).toBe(claimed.signature)
    expect(rolled.sentAt).toBe(claimed.sentAt)
  })

  it('rolls back exactly one, from whatever was claimed', async () => {
    // The invariant that keeps this non-negative is upstream: alertVerdict emits sentThisHour + 1,
    // so the claim is always at least 1. That is asserted in tests/error-alert-grouping.test.ts,
    // where it is decided. What belongs HERE is that the rollback subtracts exactly one from the
    // number that was actually claimed — not a hardcoded zero, and not two.
    cfg.sendThrows = true
    cfg.state = JSON.stringify({
      sentAt: new Date(Date.now() - 90 * 60_000).toISOString(),
      signature: 'earlier incident',
      sentThisHour: 2,
      hourStart: new Date().toISOString(),
    })
    await POST(post())
    const claimed = JSON.parse(cfg.upserts[0].value) as { sentThisHour: number }
    const rolled = JSON.parse(cfg.upserts[1].value) as { sentThisHour: number }
    expect(claimed.sentThisHour).toBeGreaterThanOrEqual(1)
    expect(rolled.sentThisHour).toBe(claimed.sentThisHour - 1)
  })

  it('says so when the ROLLBACK write is REJECTED rather than thrown', async () => {
    // supabase-js RESOLVES with { error } for a PostgREST failure. This landed in an empty success
    // handler, so the slot was silently not released and nothing was logged — the identical defect
    // that had just been fixed on the claim eighty lines above it.
    //
    // With Resend down and writes being rejected, four ticks each claim a slot, each fail to send,
    // each fail to release, and the fifth gets hourly-cap for the rest of the hour with zero emails
    // delivered and an empty log.
    cfg.sendThrows = true
    cfg.upsertErrorFrom = 1           // the claim lands; the rollback is rejected
    const res = await POST(post())
    expect(res.status).toBe(200)
    expect(cfg.upserts, 'it must still attempt the release').toHaveLength(2)
    expect(cfg.logs.some((l) => l.includes('could not release the hourly slot')),
      cfg.logs.join(' | ')).toBe(true)
  })

  it('does not fail the run when the ROLLBACK write also fails', async () => {
    // Best effort by design: the worst case is the old behaviour, and throwing here would turn a
    // mail outage into a 500 that looks like a different problem.
    cfg.sendThrows = true
    cfg.failUpsertsAfter = 1        // the claim lands, the rollback does not
    const res = await POST(post())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ alerted: false })
  })
})

describe('a cooldown that was not recorded must not be treated as recorded', () => {
  it('does NOT send when the claim write returns an error', async () => {
    // THE MAIL LOOP. This write was awaited and its result discarded, so a claim that never landed
    // looked exactly like one that did: the email went out, nothing was recorded, and every
    // subsequent tick sent again — with the hourly ceiling stored in the same row, so nothing
    // bounded it. Unbounded mail during an incident, from the line whose comment says the ordering
    // prevents exactly that.
    cfg.upsertErrorFrom = 0
    const res = await POST(post())
    expect(cfg.sent, 'an unclaimed cooldown must not send').toHaveLength(0)
    expect(await res.json()).toMatchObject({ alerted: false, reason: 'cooldown not claimed' })
    expect(cfg.logs.some((l) => l.includes('mail loop'))).toBe(true)
  })

  it('does NOT send when the claim write throws outright', async () => {
    // A network-level failure throws rather than returning { error }, and used to 500 the whole run.
    cfg.failUpsertsAfter = 0
    const res = await POST(post())
    expect(res.status).toBe(200)
    expect(cfg.sent).toHaveLength(0)
    expect(await res.json()).toMatchObject({ reason: 'cooldown not claimed' })
  })

  it('does NOT give the slot back on a successful send', async () => {
    // The mirror error: rolling back unconditionally would uncap the alarm entirely.
    await POST(post())
    expect(cfg.upserts).toHaveLength(1)
    expect(JSON.parse(cfg.upserts[0].value).sentThisHour).toBe(1)
  })

  it('the hourly ceiling is a real number, not something a rollback can defeat', () => {
    expect(MAX_ALERTS_PER_HOUR).toBeGreaterThan(0)
    expect(MAX_ALERTS_PER_HOUR).toBeLessThan(10)
  })
})

describe('a state row that could not be READ is not an empty one', () => {
  it('does not send, and does not claim, when the read fails', async () => {
    // The cooldown, the signature and the hourly ceiling all live in this one row. Reading it as
    // "no previous alert" means nothing bounds the alarm at all: every tick sends. That is the same
    // unbounded mail loop the claim check guards, reached from the other side.
    cfg.stateReadError = 'connection reset'
    const res = await POST(post())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ alerted: false, reason: 'state unreadable' })
    expect(cfg.sent, 'an unbounded alarm is worse than a missed alert').toHaveLength(0)
    expect(cfg.upserts, 'it must not claim a cooldown it could not read').toHaveLength(0)
    expect(cfg.logs.some((l) => l.includes('could not read the alert state'))).toBe(true)
  })

  it('an ABSENT row is still a perfectly good first alert', async () => {
    // Absent and unreadable are different states and must stay different — a brand-new deployment
    // has no row at all, and that must alert normally (rule 20).
    cfg.state = null
    const res = await POST(post())
    expect(await res.json()).toMatchObject({ alerted: true })
    expect(cfg.sent).toHaveLength(1)
  })
})

describe('the signature the route claims is stable across ticks', () => {
  // THE ENFORCEMENT HALF (rule 15). tallyByMessage's tiebreak is tested in the grouping module, but
  // the SIGNATURE is chosen here — `top[0]?.[0]` — and a mutation picking a different element of
  // that list would leave the module's tests green while every tick claimed a different signature,
  // defeating the same-incident rule entirely.
  const tiedRows = (order: string[]) => order.flatMap((message) => ([{
    album_id: 'album-1', message, source: 's', ua: 'Mozilla/5.0 (device-0)', context: { repeats: 50 },
  }]))

  it('is the same whichever order the tied rows come back in', async () => {
    cfg.rows = tiedRows(['Failed to fetch', 'Load failed'])
    await POST(post())
    const first = JSON.parse(cfg.upserts[0].value).signature

    cfg.upserts = []
    cfg.sent = []
    cfg.rows = tiedRows(['Load failed', 'Failed to fetch'])
    await POST(post())
    const second = JSON.parse(cfg.upserts[0].value).signature

    expect(second, 'a flipped tie must not read as a new incident').toBe(first)
  })

  it('is the DOMINATING message, not merely the alphabetically first one', async () => {
    // The dominant message is deliberately alphabetically LAST. If it were first, this test would
    // pass equally well against a signature picked by name alone, and the tiebreak added above
    // would be the thing under test rather than the weighting — proving the wrong property.
    cfg.rows = [
      { album_id: 'album-1', message: 'aaa rare', source: 's1', ua: 'Mozilla/5.0 (d)', context: { repeats: 1 } },
      { album_id: 'album-1', message: 'zzz dominant', source: 's2', ua: 'Mozilla/5.0 (d)', context: { repeats: 500 } },
    ]
    await POST(post())
    expect(JSON.parse(cfg.upserts[0].value).signature).toBe('zzz dominant')
  })
})

describe('the email reports the window that was actually queried', () => {
  it('looks back the widened window, and names that same number', async () => {
    // The query widens by the coalescing window because a row absorbing repeats keeps its ORIGINAL
    // created_at. The email named the un-widened one, so every alert ever sent reported a window
    // nobody had measured — 10 minutes for a query that looked at 15.
    await POST(post())
    const lookedBackMs = Date.now() - Date.parse(cfg.since as string)
    expect(lookedBackMs).toBeGreaterThan(14.5 * 60_000)
    expect(lookedBackMs).toBeLessThan(15.5 * 60_000)

    const { payload } = cfg.sent[0] as { payload: { windowMinutes: number } }
    expect(payload.windowMinutes, 'the number named must be the number measured').toBe(15)
    expect(payload.windowMinutes).toBe(Math.round(lookedBackMs / 60_000))
  })
})

describe('a count drawn from a full sample is reported as a floor', () => {
  it('flags truncation when the sample came back full', async () => {
    // totalOccurrences sums at most the sampled rows, so a bigger incident is UNDERSTATED. It
    // cannot suppress the alarm — 200 rows is far past the threshold of 8 — it just makes the
    // headline number false, and the operator sizes their response to it.
    cfg.rows = spike(200)
    await POST(post())
    expect(cfg.sampleLimit, 'the route must bound the sample, and this is that bound').toBe(200)
    const { payload } = cfg.sent[0] as { payload: { truncated: boolean } }
    expect(payload.truncated).toBe(true)
  })

  it('does not flag it on an ordinary spike', async () => {
    cfg.rows = spike(20)
    await POST(post())
    const { payload } = cfg.sent[0] as { payload: { truncated: boolean } }
    expect(payload.truncated).toBe(false)
  })
})
