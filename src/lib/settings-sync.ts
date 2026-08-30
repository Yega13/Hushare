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
    return { kind: 'schedule', delayMs: state.quietMs - sinceLocalEdit }
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
export function shouldCommitSettings(state: {
  /** The component went away while the request was in flight. */
  disposed: boolean
  /** The response carried a usable album row. */
  hasValidData: boolean
  /** When the request was issued. */
  requestStartedAt: number
  /** When this tab last made its own edit. */
  lastLocalEditAt: number
}): boolean {
  if (state.disposed) return false
  if (!state.hasValidData) return false
  // Strictly greater: an edit at the same millisecond as the request going out was made BEFORE it,
  // so the response already contains it and there is nothing to protect.
  return !(state.lastLocalEditAt > state.requestStartedAt)
}
