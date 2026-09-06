import { createDeadline } from '@/lib/clock'

// "IS OUR ORIGIN REACHABLE AT ALL, AND WHEN DOES IT COME BACK?" -- the question every upload retry
// loop asks before spending another attempt on a connection that may simply be gone.
//
// Moved out of UploadZone.tsx so it can be tested. Two things here were untestable in place:
//
//   1. THE SHARED PROBE. originRecovered() runs ONE polling loop for the whole page: every file
//      waiting on the same outage waits on that one promise, and they all resume together the
//      instant it clears. As a module-level `let` in the component that was correct and invisible
//      to any test. It is closure state inside createReachability() now, so a test can build an
//      instance and watch two callers share one loop.
//
//   2. THE FOUR-MINUTE BUDGET was `Date.now() + REACHABILITY_PROBE_MAX_MS` compared three times. A
//      forward clock step made the probe give up at once with the origin read as still down; a
//      backward one made it probe past its cap (rule 22). It is a createDeadline now.
//
// Only what a test needs is injectable: the fetch, the randomness that spreads a room's retries, and
// the browser's own "am I offline" flag. Timers stay real -- tests use vi.useFakeTimers(). Production
// callers use the `reachability` instance below and pass nothing.

/**
 * How long originRecovered() keeps asking before concluding the origin is not coming back.
 *
 * The shared loop deliberately has NO deadline of its own -- callers have different budgets (a
 * presign waits 30s, a save 180s), and a loop bounded by the shortest would cut the others short;
 * each caller races it against its own budget via awaitRecovery. This cap exists only so a tab left
 * open on a dead network cannot poll forever: comfortably longer than the longest caller (the 180s
 * save), so it never cuts a live caller short, it only stops an orphaned loop.
 */
export const REACHABILITY_PROBE_MAX_MS = 4 * 60_000

export type ReachabilityDeps = {
  fetch: (url: string, init: RequestInit) => Promise<{ status: number }>
  /** 0..1, for the jitter that stops a room full of phones re-probing in lockstep. */
  random?: () => number
  /** The browser's own verdict. `false` means do not even try. */
  online?: () => boolean
}

export function createReachability(deps: ReachabilityDeps) {
  const random = deps.random ?? Math.random
  const online = deps.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))

  /** One cheap HEAD to our own health route. True on anything but a 5xx or a failure to connect. */
  async function originReachable(): Promise<boolean> {
    if (!online()) return false
    try {
      const res = await deps.fetch('/api/health', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(5000) })
      return res.status < 500
    } catch {
      return false
    }
  }

  // THE shared probe. Null when nobody is waiting; otherwise the one promise every waiter shares.
  let probe: Promise<boolean> | null = null

  /**
   * Resolve true the moment the origin answers again, or false once the budget is spent.
   *
   * Callers race this against their own deadline with settleWithin(); several files waiting on the
   * same outage all wait on the same loop, so an event's worth of phones does not each hammer
   * /api/health on its own schedule.
   */
  function originRecovered(): Promise<boolean> {
    if (!probe) {
      const deadline = createDeadline(REACHABILITY_PROBE_MAX_MS)
      const loop = (async () => {
        let attempt = 0
        // ONE exit check, not two. The original tested `deadline.expired()` at the top AND
        // `wouldOverrun(wait)` before sleeping; the two overlap so completely that deleting either
        // alone left every test green (rule 16). Giving up when the NEXT wait would overrun is the
        // whole rule: the probe never sleeps past its budget, and never gives up before it.
        for (;;) {
          if (await originReachable()) return true
          attempt++
          // 1s, 2s, 3s ... capped at 5s, each spread across half its value so phones that lost the
          // network together do not all ask again in the same instant.
          const wait = Math.min(5000, 1000 * attempt) * (0.5 + random() * 0.5)
          if (deadline.wouldOverrun(wait)) return false
          await new Promise((r) => setTimeout(r, wait))
        }
      })()
      probe = loop
      // Unconditional on purpose. It was `if (probe === loop) probe = null` -- but a new loop is only
      // ever created when the slot is null, and only this callback empties it, so the slot always
      // still holds `loop` here. A guard that cannot be false would read as protecting a race that
      // does not exist.
      void loop.finally(() => { probe = null })
    }
    return probe
  }

  /**
   * Wait for the origin to answer again -- but never past `remainingMs`, and never past the
   * caller's own cancel. True only on a CONFIRMED recovery; false on timeout or abort, after which
   * the caller's loop takes its next step (and sees the expired deadline or aborted signal itself).
   *
   * This is the one wait every retry loop performs during an outage. It used to exist three times:
   * fetchWithRetry raced the shared probe against its deadline but could not be cancelled while it
   * waited (a guest tapping Cancel in a 30-second outage window waited the window out), and
   * putWithRetry and relayUploadImage each carried their own inline copy of the 1s..5s probe curve
   * that polled per FILE rather than per page -- fifty stalled photos, fifty HEAD loops. One shared
   * loop, one exit on cancel, one place (rule 13).
   */
  function awaitRecovery({ remainingMs, signal }: { remainingMs: number; signal?: AbortSignal }): Promise<boolean> {
    if (remainingMs <= 0 || signal?.aborted) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      // settle() can run twice -- the shared probe keeps going for other waiters after THIS caller's
      // timer fired, and resolves later. A promise settles once, and clearing a dead timer or
      // removing an absent listener is a no-op, so no flag guards it.
      const settle = (v: boolean) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(v)
      }
      const onAbort = () => settle(false)
      const timer = setTimeout(() => settle(false), remainingMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      // No rejection handler: originRecovered() cannot reject -- originReachable() catches every
      // failure and answers false -- so a handler here would be code that cannot run.
      void originRecovered().then(settle)
    })
  }

  return { originReachable, originRecovered, awaitRecovery }
}

export type Reachability = ReturnType<typeof createReachability>

/** The page-wide instance production code uses. One shared probe per page, as before. */
export const reachability: Reachability = createReachability({ fetch: (url, init) => fetch(url, init) })
