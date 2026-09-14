import { fallbackPollDelay } from '@/lib/realtime-fallback'
import { forcedRefreshAllowed } from '@/lib/album-freshness'
import { realTimers, type Timers } from '@/lib/settings-sync'

// WHAT THE PHOTOS CHANNEL DOES ON EACH EVENT -- the timers and the rules that keep them from
// stacking. Every one of those rules is a shipped bug:
//
//  - a reconnect timer overwritten but not cleared, because CHANNEL_ERROR and TIMED_OUT both arrive
//    for one failed join: one extra reconnect loop per drop, accumulating for as long as a
//    websocket-blocking venue network kept the page open, all draining as a refetch herd the
//    moment connectivity returned (167023e);
//  - a fallback poll armed on every failure instead of once: a second poll loop per retry;
//  - a fixed reconnect delay: a venue access point drops every guest at once, 300 phones wait
//    exactly 2000 ms, and all come back together against an origin least able to carry it;
//  - a debounce with no maximum wait: pings arriving faster than the debounce held the refresh off
//    for as long as they kept coming (review of 2026-09-14; see REFETCH_MAX_WAIT_MS).
//
// The decision "wait 2 s, jittered" means nothing without "and cancel the previous one" (rule 15),
// so the timers live here with the rules -- and so, since the live wall needed the same rules, does
// the channel lifecycle (watchPhotosChannel, below). The components keep only the Supabase calls.

export const RECONNECT_BASE_MS = 2000
export const RECONNECT_CAP_MS = 30_000

/**
 * THE LONGEST A REFRESH MAY WAIT WHILE BROADCASTS KEEP ARRIVING.
 *
 * The debounce replaces its pending timer on every ping. That collapses a burst into one refetch --
 * and, with nothing else, never refetches at all while pings come faster than the debounce. A steady
 * upload stream at an event does that, and so can anyone holding the album link: the channel is
 * public, so a script sending `changed` every second froze every viewer's album, and the wall on the
 * projector, for as long as it ran. So the first ping of a burst also starts this timer, which later
 * pings do NOT move; whichever of the two fires first refreshes and clears both.
 *
 * 10 s: a guest watching a busy album sees new photos at least that often, and a flood of forged
 * pings costs each viewer one probe per interval instead of a frozen page. It never raises the request
 * rate: the debounce alone already refreshes more often than this whenever pings leave it room to fire.
 */
export const REFETCH_MAX_WAIT_MS = 10_000

/**
 * Exponential backoff with FULL jitter: 2 s, 4 s, 8 s, 16 s, capped at 30 s, each spread across
 * the upper half of its nominal value (the same 0.5 + rand * 0.5 form as the upload retry path).
 */
export function reconnectDelay(retryCount: number, rand: () => number = Math.random): number {
  return Math.min(RECONNECT_BASE_MS * Math.pow(2, retryCount), RECONNECT_CAP_MS) * (0.5 + rand() * 0.5)
}

/**
 * The refetch debounce after a broadcast, jittered: every viewer receives the broadcast within
 * milliseconds of every other, so a fixed delay makes 400 phones fetch in the same instant. The max
 * wait is jittered the same way, for the same reason -- every viewer got that first ping together.
 */
export function refetchDebounceDelay(baseMs: number, rand: () => number = Math.random): number {
  return Math.round(baseMs * (0.75 + rand() * 0.5))
}

export type ChannelStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'

export type SupervisorConfig = {
  /** Build and subscribe a channel; its status events come back through onStatus. */
  connect: () => void
  /** Refresh the window (the probe-first refresh). `force` skips the probe. */
  refresh: (opts: { force: boolean }) => void
  /** Wall clock, for the forced-refresh bound (it rate-limits a forgeable broadcast). */
  now: () => number
  debounceMs: number
  pollDelay?: () => number
  timers?: Timers
  rand?: () => number
}

export type ChannelSupervisor = {
  onStatus(status: ChannelStatus): void
  onChanged(): void
  dispose(): void
  /** For tests and diagnostics: is the fallback poll running. */
  pollArmed(): boolean
}

export function createChannelSupervisor(config: SupervisorConfig): ChannelSupervisor {
  const timers = config.timers ?? realTimers
  const rand = config.rand ?? Math.random
  const pollDelay = config.pollDelay ?? (() => fallbackPollDelay(rand))
  let active = true
  let retryCount = 0
  let retryTimer: number | null = null
  let refetchTimer: number | null = null
  let maxWaitTimer: number | null = null
  let pollTimer: number | null = null
  // Per supervisor, so a reconnect does not hand a forged broadcast a fresh allowance per flap.
  let lastForcedRefreshAt: number | null = null

  // Runs ONLY while the channel is down. The backoff handles drops; this handles REFUSAL (venue
  // networks that block websockets, the realtime service at its connection cap): without it those
  // clients retry forever, never reach SUBSCRIBED, never refetch, and the page silently freezes.
  function pollWhileDown() {
    if (!active) return
    config.refresh({ force: false })
    pollTimer = timers.set(pollWhileDown, pollDelay())
  }

  // ONE refresh per burst, from whichever of the debounce and the max wait fires first. Both are
  // cleared here, or the other one fires a second refresh for the same burst.
  function refetchForBurst() {
    if (refetchTimer !== null) { timers.clear(refetchTimer); refetchTimer = null }
    if (maxWaitTimer !== null) { timers.clear(maxWaitTimer); maxWaitTimer = null }
    if (!active) return
    // A broadcast means something DID change, and a reorder moves neither field the probe
    // compares -- so force, but rate-limited: anyone with the link can publish this
    // broadcast with the public anon key.
    const now = config.now()
    const force = forcedRefreshAllowed(lastForcedRefreshAt, now)
    if (force) lastForcedRefreshAt = now
    config.refresh({ force })
  }

  return {
    onStatus(status) {
      if (!active) return
      if (status === 'SUBSCRIBED') {
        // Always refetch on subscribe: photos uploaded between the first fetch and the join
        // would otherwise be missed until the next event.
        config.refresh({ force: false })
        retryCount = 0
        // Realtime is back: the broadcast channel is the fresh-data path again.
        if (pollTimer !== null) { timers.clear(pollTimer); pollTimer = null }
        return
      }
      const delay = reconnectDelay(retryCount, rand)
      retryCount++
      // Clear before reassigning: CHANNEL_ERROR and TIMED_OUT can both arrive for one failed
      // join, and an overwritten-but-live timer is one extra reconnect loop. Each.
      if (retryTimer !== null) timers.clear(retryTimer)
      retryTimer = timers.set(() => { retryTimer = null; if (active) config.connect() }, delay)
      // The first failure arms the poll; later ones must not stack a second loop. The first poll
      // waits a full interval: the page load already fetched, there is nothing to catch up on.
      if (pollTimer === null) pollTimer = timers.set(pollWhileDown, pollDelay())
    },
    onChanged() {
      if (!active) return
      // A burst of uploads sends many pings; collapse them into ONE refetch, replacing (not
      // stacking) the pending one. The request count is what breaks at a venue: 300 guests on one
      // public IP share one rate bucket.
      if (refetchTimer !== null) timers.clear(refetchTimer)
      refetchTimer = timers.set(refetchForBurst, refetchDebounceDelay(config.debounceMs, rand))
      // ...but never later than the max wait, which only the FIRST ping of a burst sets.
      if (maxWaitTimer === null) maxWaitTimer = timers.set(refetchForBurst, refetchDebounceDelay(REFETCH_MAX_WAIT_MS, rand))
    },
    dispose() {
      active = false
      if (retryTimer !== null) { timers.clear(retryTimer); retryTimer = null }
      if (refetchTimer !== null) { timers.clear(refetchTimer); refetchTimer = null }
      if (maxWaitTimer !== null) { timers.clear(maxWaitTimer); maxWaitTimer = null }
      if (pollTimer !== null) { timers.clear(pollTimer); pollTimer = null }
    },
    pollArmed: () => pollTimer !== null,
  }
}

/**
 * The three Supabase calls the photos channel needs, and nothing else. Structural, so this module never
 * imports the client and a test can hand it a fake that echoes exactly the way the real one does.
 */
export type PhotosChannelPort<C> = {
  /** Build the `album:<id>` channel with its `changed` listener. Must not subscribe. */
  create(onChanged: () => void): C
  subscribe(channel: C, onStatus: (status: string) => void): void
  remove(channel: C): void
}

/**
 * THE PHOTOS CHANNEL ITSELF: one live channel at a time, and only its own status events reach the
 * supervisor. Returns the cleanup.
 *
 * Moved here from AlbumPageClient so the live wall runs the same rules. PhotoWall carried its own copy
 * -- a 500 ms debounce with no maximum wait, an un-jittered backoff, no fallback poll -- so a venue
 * network that refuses websockets froze the wall on the projector, and a stream of pings held its
 * refresh off for as long as it lasted.
 *
 * Two orderings make the lifecycle correct, and each was a shipped bug (167023e):
 *  - the current channel is FORGOTTEN BEFORE it is removed. removeChannel fires CLOSED into the old
 *    channel's own callback -- synchronously when the socket cannot push, which is exactly the
 *    refused-websocket state -- and that echo must already fail the identity check, or every retry's
 *    own teardown schedules one more connect;
 *  - the new channel is RECORDED BEFORE it subscribes, so its own first status event can never be
 *    mistaken for a stale echo, however promptly it fires.
 */
export function watchPhotosChannel<C>(port: PhotosChannelPort<C>, config: Omit<SupervisorConfig, 'connect'>): () => void {
  let current: C | null = null
  const supervisor = createChannelSupervisor({ ...config, connect: () => connect() })

  function connect() {
    const prev = current
    current = null
    if (prev !== null) port.remove(prev)

    const ch = port.create(() => supervisor.onChanged())
    current = ch
    port.subscribe(ch, (status) => {
      // The identity check is load-bearing: a channel replaced by a newer connect() still fires
      // CLOSED (and stray errors) into THIS callback, and would re-arm its successor's timers.
      if (ch !== current) return
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        supervisor.onStatus(status)
      }
    })
  }

  connect()

  // After dispose the supervisor ignores everything, so the removal's own CLOSED echo, and any event a
  // dead channel still delivers, change nothing.
  return () => {
    supervisor.dispose()
    const last = current
    current = null
    if (last !== null) port.remove(last)
  }
}
