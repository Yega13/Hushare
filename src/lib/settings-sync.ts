// WHEN AN ALBUM'S SETTINGS CHANGE SOMEWHERE, WHAT SHOULD THIS TAB DO ABOUT IT?
//
// Every owner mutation broadcasts, and the owner's own tab is subscribed to that broadcast. So each
// edit made the owner refetch and merge the whole album row back over their own optimistic state.
// Two edits inside one network round trip — or one debounced slider firing twice — and the first
// response lands AFTER the second edit and overwrites it with the pre-edit row, until the second
// broadcast puts it back.
//
// That is the "control moves to the new value, snaps back to the old one, then settles" glitch. It
// only ever showed up on a phone, because the race window is exactly one network round trip wide.
//
// The rules were spread across an effect, a callback and a timer, expressed in refs that only exist
// while the component is mounted. Nothing could test them, and a glitch that lasts one round trip
// is not something anyone can reliably reproduce by hand either. They are the same rules; they are
// now somewhere they can be asked.

/** What to do with a broadcast that just arrived. */
export type BroadcastAction =
  /** Fetch now — this is real news from somewhere else. */
  | { kind: 'refetch' }
  /** The Designer is open: its live preview must not be overwritten. Owe the refetch instead. */
  | { kind: 'owe' }
  /** Too close to this tab's own edit to trust. Wait for the owner to stop, then fetch once. */
  | { kind: 'schedule'; delayMs: number }

export function onSettingsBroadcast(state: {
  /** The Album Designer is open, showing an optimistic preview a refetch would clobber. */
  designerOpen: boolean
  now: number
  /** When this tab last made its own edit. 0 if it never has. */
  lastLocalEditAt: number
  /** How long after a local edit a broadcast is assumed to be that edit echoing back. */
  quietMs: number
}): BroadcastAction {
  if (state.designerOpen) return { kind: 'owe' }

  const sinceLocalEdit = state.now - state.lastLocalEditAt
  if (sinceLocalEdit < state.quietMs) {
    // Deferred rather than dropped, and that distinction matters: a genuine change made from
    // ANOTHER device during the quiet window would otherwise be lost entirely. One trailing fetch
    // once the owner stops picks it up.
    //
    // CLAMPED, because Date.now() is a wall clock and can go backwards — a phone waking to an NTP
    // correction, or a device with a wrong RTC correcting on boot. (NOT a timezone change —
    // Date.now() is UTC epoch ms.) sinceLocalEdit then goes negative and the raw arithmetic
    // schedules the refresh (quietMs + the size of the jump) into the future: an hour-long jump
    // defers it an hour, and every later broadcast re-defers it by another hour, so settings
    // changed on another device never arrive again for the rest of the session.
    const delayMs = Math.min(state.quietMs, Math.max(0, state.quietMs - sinceLocalEdit))
    return { kind: 'schedule', delayMs }
  }
  return { kind: 'refetch' }
}

/**
 * A response has come back. Is it still safe to apply?
 *
 * An edit made in this tab AFTER the request went out is newer than anything the response can
 * contain, so committing it would overwrite the owner's own change with the pre-change row.
 * Dropping it is always safe: that edit was already applied optimistically and its own broadcast is
 * still to come.
 */
export function shouldCommitSettings<T extends { id?: unknown }>(
  data: T | null | undefined,
  state: {
    /** The component went away while the request was in flight. */
    disposed: boolean
    /** When the request was issued. */
    requestStartedAt: number
    /** When this tab last made its own edit. */
    lastLocalEditAt: number
  },
): data is T {
  if (state.disposed) return false
  // A TYPE PREDICATE ON THE DATA, not a bare boolean. As a boolean, the caller's `data` stayed
  // `Album | null` afterwards and `{ ...prev, ...data }` compiled happily while spreading null —
  // a silent no-op that still allocates a new object and re-renders every consumer of the album.
  // The guard this replaced narrowed the type; giving that up was a real loss.
  if (!data || typeof data.id !== 'string') return false
  // Strictly greater: an edit at the same millisecond as the request going out was made BEFORE it,
  // so the response already contains it and there is nothing to protect. Using >= here would throw
  // away a good response on every fast edit.
  return !(state.lastLocalEditAt > state.requestStartedAt)
}

/** The timer functions, injectable so a test can drive the debounce without waiting in real time. */
export type Timers = {
  set(fn: () => void, ms: number): number
  clear(id: number): void
}

const realTimers: Timers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
}

/**
 * The decision above, WITH the cancellation that enforces it.
 *
 * Deciding to "schedule in 1,400ms" is only half the rule. The other half is that a second
 * broadcast must REPLACE that pending fetch rather than add another — a slider dragged for five
 * seconds emits a broadcast per step, and without cancellation each one queues its own refetch.
 * That is the original glitch restored, one fetch at a time.
 *
 * That cancellation used to live in the component as a bare `if (settleTimer) clearTimeout(...)`,
 * which meant deleting it broke the product and passed every test in this file: the module had the
 * decision and the component had the enforcement, so neither could be checked on its own. Owning
 * the timer here is what makes "exactly one fetch after the owner stops" an assertable claim.
 */
export function createSettingsSync(config: {
  quietMs: number
  /** Go and fetch the album's settings now. */
  refetch: () => void
  /** The Designer is open — remember that a refetch is owed once it closes. */
  markOwed: () => void
  timers?: Timers
}) {
  const timers = config.timers ?? realTimers
  let pending: number | null = null

  const cancelPending = () => {
    if (pending !== null) timers.clear(pending)
    pending = null
  }

  return {
    onBroadcast(state: { designerOpen: boolean; now: number; lastLocalEditAt: number }): void {
      const action = onSettingsBroadcast({ ...state, quietMs: config.quietMs })
      if (action.kind === 'owe') { config.markOwed(); return }
      if (action.kind === 'schedule') {
        // Replace, never stack. This single line is the difference between one fetch when the
        // owner stops and one fetch per broadcast while they are still going.
        cancelPending()
        pending = timers.set(() => { pending = null; config.refetch() }, action.delayMs)
        return
      }
      // A real refetch supersedes anything queued: the queued one existed only to wait out an echo
      // that is now over.
      cancelPending()
      config.refetch()
    },
    /** Drop any queued fetch — the album page is going away. */
    dispose: cancelPending,
    /** For tests and diagnostics: is a trailing fetch currently queued? */
    hasPending: () => pending !== null,
  }
}
