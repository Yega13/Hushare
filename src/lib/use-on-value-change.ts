'use client'
import { useState } from 'react'

/**
 * WHEN A VALUE CHANGES, ADJUST STATE DURING RENDER -- not in an effect.
 *
 * Eight places in the photo grid say the same thing: the lightbox moves to another photo, so the
 * zoom, the flip, the swipe offset, the measured media node, the encoding percentage and the
 * flipped-card id all go back to their starting values. Every one of them did it in an effect keyed
 * on the id, and each is a `react-hooks/set-state-in-effect` finding for the same reason: React
 * commits the OLD state first, runs the effect, then renders again. On a lightbox that is a frame
 * showing the previous photo's zoom applied to the new photo.
 *
 * Adjusting during render costs no committed frame at all: React notices the state changed while
 * rendering, throws the output away and renders again before anything reaches the screen. It is the
 * pattern React documents for "adjusting state when a prop changes", and it is what
 * `lib/use-draft-of.ts` already does for a field somebody is typing in -- this is the same
 * machinery with the reset left to the caller.
 *
 * THE GUARD IS THE WHOLE THING. Without the `Object.is` comparison this sets state on every render,
 * which is an infinite render loop, so the guard is mutated in both directions in
 * `scripts/mutations/use-on-value-change.mjs`. `Object.is` rather than `!==`, so a NaN value (a
 * measured dimension that failed) is stable rather than restarting the render forever.
 *
 * WHAT MAY GO IN THE CALLBACK: setState of this component, and nothing else. No DOM, no network, no
 * ref writes, no toasts. A render can be thrown away and replayed, so anything with a side effect
 * belongs in an event handler or an effect -- and a ref write during render is what
 * `react-hooks/refs` forbids for exactly that reason.
 */
export function useOnValueChange<T>(value: T, onChange: (next: T, previous: T) => void): void {
  const [seen, setSeen] = useState<T>(value)
  if (!Object.is(value, seen)) {
    setSeen(value)
    onChange(value, seen)
  }
}
