'use client'

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

// A VALUE THAT ONLY EXISTS IN THE BROWSER, READ ONCE AFTER HYDRATION.
//
// The query string, localStorage, a random pick, the current time: none of them can be read while
// the server renders, and reading them during the client's FIRST render is worse than not having
// them -- React compares that render against the server's HTML and a mismatch throws the whole
// subtree away, remounts it, and logs a hydration error in production. Picking a random placeholder
// during render is the clearest case: the server picks one, the client picks another, and they can
// never agree.
//
// So the value is read in an effect, after hydration has finished, and the component renders a
// fallback until then. That is the correct pattern and it is what fifteen components here were
// already doing by hand.
//
// WHY IT IS A HOOK RATHER THAN FIFTEEN EFFECTS. react-hooks/set-state-in-effect flags every one of
// them, because the rule models a pure client render where setting state from an effect is a
// wasted pass. It cannot see SSR, so it cannot tell this idiom from the real smell it is meant to
// catch -- state derived from a prop, which should be computed during render instead. Fifteen
// identical findings in a budget file say "we gave up"; they were the one thing in that budget that
// was never debt at all.
//
// Now the idiom has a name, the reason is written once, and the rule fires once -- here, where the
// suppression carries its explanation instead of being repeated per file. Anything still flagged
// elsewhere is a real finding again, which is the point.
//
// NOT for values that change. This reads once, on mount. A subscription to something that keeps
// changing wants useSyncExternalStore, which has its own reasons and its own hazards.

/**
 * Read a browser-only value after hydration.
 *
 * @param read called once, on mount, inside an effect. Must not throw -- but if it does, the
 *   fallback stands rather than taking the page down with it. A component that cannot read
 *   localStorage (Safari private mode, storage disabled) should render as if there were nothing
 *   stored, not fail (rule 19).
 * @param fallback what renders on the server and on the first client render. These must agree, so
 *   it has to be a constant, not another read.
 */
export function useBrowserValue<T>(read: () => T, fallback: T): T {
  return useBrowserSeededState(read, fallback)[0]
}

/**
 * The same read, for a value the person then EDITS.
 *
 * A form field pre-filled from the query string is still state: the seed comes from the browser,
 * and everything after it comes from typing. Returning the setter is the difference between this
 * and useBrowserValue, and it is why they cannot be one function.
 *
 * The seed lands once, on mount. Someone who types in the field before hydration finishes would
 * have that overwritten -- true, and bounded by hydration taking milliseconds on a form that has
 * only just appeared. The alternative, seeding only when the field is untouched, needs a "touched"
 * flag whose own first render has the same problem.
 */
export function useBrowserSeededState<T>(read: () => T, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(fallback)
  useEffect(() => {
    let v: T
    try {
      v = read()
    } catch {
      return
    }
    // THE ONE SUPPRESSION, AND THE WHOLE REASON THIS FILE EXISTS. react-hooks/set-state-in-effect
    // is right about the pattern it models -- state set from an effect is usually state that should
    // have been computed during render -- and wrong about this one, because it cannot see that the
    // first render has to match HTML the server already sent. Suppressed here, once, next to the
    // paragraph explaining it, instead of in every component that needs a browser value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(v)
    // `read` is deliberately not a dependency. This reads ONCE, and an inline arrow at the call
    // site changes identity on every render -- depending on it would re-read forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return [value, setValue]
}

/**
 * Has hydration finished?
 *
 * The same idea with nothing to read: for the components whose only need is "do not render this
 * until the client is live". Rendering the browser-dependent branch before this is true is the
 * hydration mismatch, restated.
 */
export function useHydrated(): boolean {
  return useBrowserValue(() => true, false)
}
