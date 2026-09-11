'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'

// A FIELD SOMEBODY IS TYPING IN, WHOSE VALUE CAN ALSO CHANGE UNDERNEATH THEM.
//
// A colour box, a number input, a date field: while it has focus its contents are a DRAFT, which
// may be halfway to being valid ("#FF" is not a colour yet) and must not be pushed back to the
// parent on every keystroke. But the same field also has to follow the real value when that changes
// from somewhere else -- the owner picks a colour from the swatch, another panel resets the design,
// a save comes back.
//
// WHY NOT AN EFFECT. The obvious spelling is `useEffect(() => setDraft(value), [value])`, and it
// was written that way in four places here. It works, and it costs a wasted render every time:
// React commits the stale draft, runs the effect, sets state, and renders again. On a slider that
// is a visible lag, and react-hooks/set-state-in-effect flags it correctly -- this is the real
// smell the rule is for, not the hydration case that lib/use-browser-value handles.
//
// THE FIX IS REACT'S OWN. Comparing against the previous value DURING render and adjusting there is
// explicitly supported: React restarts the render immediately, before touching the DOM or running
// effects, so nothing stale is ever committed and there is no second pass to see. The guard is what
// makes it safe -- `source !== seen` is false on the very next render, so it cannot loop.

/**
 * A local draft of `source`, reset whenever `source` changes from outside.
 *
 * @param source the real value, owned by the parent.
 * @param toDraft how the real value is spelled in the field. A number input shows a string; a
 *   colour shows itself. Called during render, so it must be pure and cheap.
 *
 * Returns the draft and its setter. Typing sets the draft only; the caller decides when a draft is
 * good enough to send upward, which is the whole point of having one.
 */
export function useDraftOf<S, D>(source: S, toDraft: (source: S) => D): [D, Dispatch<SetStateAction<D>>] {
  const [draft, setDraft] = useState<D>(() => toDraft(source))
  const [seen, setSeen] = useState<S>(source)
  if (!Object.is(source, seen)) {
    // Adjusting state during render, deliberately. React discards this pass and restarts before
    // committing, so the draft below is never one render behind the value it is a draft of.
    setSeen(source)
    setDraft(toDraft(source))
  }
  return [draft, setDraft]
}
