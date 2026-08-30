// UNDO AND REDO FOR AN EDITOR, extracted from the card editor where it ran untested.
//
// This is the machinery a person trusts twenty minutes of design work to, and every way it can be
// wrong is silent: undo past the start yields an index of -1 and `states[idx]` is undefined — the
// canvas goes blank and the work looks destroyed; a push after an undo that fails to truncate the
// redo branch lets "redo" resurrect an edit the user deliberately replaced; an uncapped history
// grows one full canvas snapshot per keystroke until the tab dies.
//
// Generic over the state type because nothing here cares what an editor edits.

export type HistoryAction<T> =
  /** A new edit. Anything ahead of the cursor — the redo branch — is discarded. */
  | { type: 'PUSH'; state: T }
  /** Reset to exactly one state, e.g. after loading a saved card. Undo cannot cross a load. */
  | { type: 'REPLACE'; state: T }
  | { type: 'UNDO' }
  | { type: 'REDO' }

export type HistoryState<T> = { states: T[]; idx: number }

/**
 * How many snapshots are kept. Each is a full copy of the canvas, so the cap bounds memory; 50 is
 * far more undo depth than anyone walks back through and small enough that a long session cannot
 * grow without limit.
 */
export const HISTORY_CAP = 50

export function historyReducer<T>(s: HistoryState<T>, a: HistoryAction<T>): HistoryState<T> {
  switch (a.type) {
    case 'PUSH': {
      // Truncate at the cursor FIRST: after an undo, a new edit replaces the abandoned future.
      // Keeping it would let redo resurrect work the user consciously edited over.
      const states = [...s.states.slice(0, s.idx + 1), a.state].slice(-HISTORY_CAP)
      return { states, idx: states.length - 1 }
    }
    case 'REPLACE':
      return { states: [a.state], idx: 0 }
    case 'UNDO':
      // Clamped at 0. One step past the beginning would make the current state undefined — a blank
      // canvas presented to someone who just asked to go back one step.
      return { ...s, idx: Math.max(0, s.idx - 1) }
    case 'REDO':
      return { ...s, idx: Math.min(s.states.length - 1, s.idx + 1) }
  }
}
