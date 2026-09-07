// THE TWO-TAP DELETE, AS A STATE MACHINE.
//
// Deleting an album is the one owner action that cannot be undone past a week, so the panel makes
// the owner tap twice, shows the error where the tap was, and -- since deletion became a bin --
// holds the redirect until the owner has seen the undo. That was three booleans and a nullable
// number inside a 2,000-line component, with the transitions spread across two handlers, a cancel
// button and a resync effect. This is the same machine, written once, where each transition is a
// test.

export type DeleteFlow =
  | { phase: 'idle' }
  | { phase: 'confirm'; error: string }
  | { phase: 'deleting' }
  | { phase: 'deleted'; restorableForDays: number }

export type DeleteEvent =
  | { type: 'tap' }                                   // the red button
  | { type: 'cancel' }
  | { type: 'succeeded'; restorableForDays: number }
  | { type: 'failed'; error: string }

export const DELETE_IDLE: DeleteFlow = { phase: 'idle' }

/**
 * The next state. Events that make no sense in the current phase leave it unchanged rather than
 * throwing: a double-tap during the request, or a late failure after a success, must never put the
 * panel into a shape the owner cannot get out of.
 */
export function deleteFlowNext(flow: DeleteFlow, event: DeleteEvent): DeleteFlow {
  switch (flow.phase) {
    case 'idle':
      return event.type === 'tap' ? { phase: 'confirm', error: '' } : flow
    case 'confirm':
      if (event.type === 'tap') return { phase: 'deleting' }
      if (event.type === 'cancel') return DELETE_IDLE
      return flow
    case 'deleting':
      if (event.type === 'succeeded') return { phase: 'deleted', restorableForDays: event.restorableForDays }
      // Back to the confirm step WITH the reason, so the owner can read it and tap again or cancel.
      if (event.type === 'failed') return { phase: 'confirm', error: event.error }
      return flow
    case 'deleted':
      return flow
  }
}

/** Does the second tap send the request? Only from the confirm step. */
export function deleteTapSends(flow: DeleteFlow): boolean {
  return flow.phase === 'confirm'
}
