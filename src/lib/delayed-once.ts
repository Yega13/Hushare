import { realTimers, type Timers } from '@/lib/settings-sync'

// ONE ACTION, A LITTLE AFTER THE LAST REQUEST FOR IT.
//
// The album page refreshes its window 3 s after the uploader's last upload, so realtime gets a
// chance to deliver first and a burst of uploads costs one refetch rather than one each. The rule
// "replace, never stack" plus the three places that must CANCEL it -- a slug change (a timer from
// album A used to refetch A's photos over album B), a retry, and unmount -- lived as four
// hand-written clearTimeout sites in the component, none of them testable (rule 15). The timer is
// owned here, so "two requests in 3 s run once" and "cancelled means nothing fires" are assertions.
// The action is handed over at request time, so the latest one always wins and the component
// needs no ref to reach it.

export type DelayedOnce = {
  /** Run `action` after the delay, replacing any earlier request still waiting. */
  request(action: () => void): void
  /** Drop a waiting request; nothing fires until the next request. */
  cancel(): void
  pending(): boolean
}

export function createDelayedOnce(config: { delayMs: number; timers?: Timers }): DelayedOnce {
  const timers = config.timers ?? realTimers
  let handle: number | null = null
  return {
    request(action) {
      if (handle !== null) timers.clear(handle)
      handle = timers.set(() => { handle = null; action() }, config.delayMs)
    },
    cancel() {
      if (handle !== null) timers.clear(handle)
      handle = null
    },
    pending: () => handle !== null,
  }
}
