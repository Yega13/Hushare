import { fallbackPollDelay } from '@/lib/realtime-fallback'
import { forcedRefreshAllowed } from '@/lib/album-freshness'
import type { Timers } from '@/lib/settings-sync'

// WHAT THE PHOTOS CHANNEL DOES ON EACH EVENT -- the three timers and the rules that keep them from
// stacking. Every one of those rules is a shipped bug:
//
//  - a reconnect timer overwritten but not cleared, because CHANNEL_ERROR and TIMED_OUT both arrive
//    for one failed join: one extra reconnect loop per drop, accumulating for as long as a
//    websocket-blocking venue network kept the page open, all draining as a refetch herd the
//    moment connectivity returned (167023e);
//  - a fallback poll armed on every failure instead of once: a second poll loop per retry;
//  - a fixed reconnect delay: a venue access point drops every guest at once, 300 phones wait
//    exactly 2000 ms, and all come back together against an origin least able to carry it.
//
// The decision "wait 2 s, jittered" means nothing without "and cancel the previous one" (rule 15),
// so the timers live here with the rules. The socket itself, and the channel identity guard that
// filters a replaced channel's echoes, stay in the component: this receives only events the
// component has already attributed to the live channel.

export const RECONNECT_BASE_MS = 2000
export const RECONNECT_CAP_MS = 30_000

/**
 * Exponential backoff with FULL jitter: 2 s, 4 s, 8 s, 16 s, capped at 30 s, each spread across
 * the upper half of its nominal value (the same 0.5 + rand * 0.5 form as the upload retry path).
 */
export function reconnectDelay(retryCount: number, rand: () => number = Math.random): number {
  return Math.min(RECONNECT_BASE_MS * Math.pow(2, retryCount), RECONNECT_CAP_MS) * (0.5 + rand() * 0.5)
}

/**
 * The refetch debounce after a broadcast, jittered: every viewer receives the broadcast within
 * milliseconds of every other, so a fixed delay makes 400 phones fetch in the same instant.
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

const realTimers: Timers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
}

export function createChannelSupervisor(config: SupervisorConfig): ChannelSupervisor {
  const timers = config.timers ?? realTimers
  const rand = config.rand ?? Math.random
  const pollDelay = config.pollDelay ?? (() => fallbackPollDelay(rand))
  let active = true
  let retryCount = 0
  let retryTimer: number | null = null
  let refetchTimer: number | null = null
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
      refetchTimer = timers.set(() => {
        refetchTimer = null
        if (!active) return
        // A broadcast means something DID change, and a reorder moves neither field the probe
        // compares -- so force, but rate-limited: anyone with the link can publish this
        // broadcast with the public anon key.
        const now = config.now()
        const force = forcedRefreshAllowed(lastForcedRefreshAt, now)
        if (force) lastForcedRefreshAt = now
        config.refresh({ force })
      }, refetchDebounceDelay(config.debounceMs, rand))
    },
    dispose() {
      active = false
      if (retryTimer !== null) { timers.clear(retryTimer); retryTimer = null }
      if (refetchTimer !== null) { timers.clear(refetchTimer); refetchTimer = null }
      if (pollTimer !== null) { timers.clear(pollTimer); pollTimer = null }
    },
    pollArmed: () => pollTimer !== null,
  }
}
