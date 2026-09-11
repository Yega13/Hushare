// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { useBrowserValue, useHydrated } from '@/lib/use-browser-value'

// THE IDIOM THAT WAS FIFTEEN COPIES AND ONE LINE OF A BUDGET FILE.
//
// A browser-only value cannot be read while the server renders, and reading it during the client's
// FIRST render is worse than not having it: React compares that render against the server's HTML,
// and a mismatch throws the subtree away and remounts it. So it is read after hydration, and the
// component shows a fallback until then.
//
// What has to hold: the fallback renders first (or the server and client disagree), the real value
// arrives after, it is read exactly once however often the component re-renders, and a read that
// throws leaves the fallback standing rather than taking the page down.

afterEach(cleanup)

function Shows({ read, fallback }: { read: () => string; fallback: string }) {
  return <p data-testid="v">{useBrowserValue(read, fallback)}</p>
}

describe('a browser-only value arrives after hydration, never during it', () => {
  it('renders the fallback first, then the real value', async () => {
    // Recorded rather than observed after the fact: render() flushes effects inside act(), so by
    // the time it returns the second pass has already happened. What matters is what the FIRST
    // pass produced -- that is the frame the server also produced, and the one React compares.
    const seen: string[] = []
    function Recorder() {
      const v = useBrowserValue(() => 'from-the-browser', 'server-safe')
      seen.push(v)
      return <p data-testid="v">{v}</p>
    }
    render(<Recorder />)
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('from-the-browser'))
    expect(seen[0], 'the first render must match what the server sent').toBe('server-safe')
    expect(seen.at(-1)).toBe('from-the-browser')
  })

  it('reads ONCE, however many times the component renders', async () => {
    // The read is an inline arrow at every call site, so its identity changes on every render.
    // Depending on it would re-read forever, which for a random pick means a value that never
    // settles and for localStorage means a read per keystroke.
    let reads = 0
    function Counter() {
      const v = useBrowserValue(() => { reads++; return 'x' }, '-')
      const hydrated = useHydrated()
      return <p data-testid="v">{v}{hydrated ? '!' : ''}</p>
    }
    render(<Counter />)
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('x!'))
    expect(reads, 'the browser value must be read exactly once').toBe(1)
  })

  it('a read that THROWS leaves the fallback standing', async () => {
    // Safari in private mode throws on localStorage. A component that cannot read its stored state
    // should render as though nothing were stored, not take the page down with it (rule 19).
    render(<Shows read={() => { throw new Error('storage is disabled') }} fallback="nothing-stored" />)
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('nothing-stored'))
  })

  it('a value that is legitimately falsy still replaces the fallback', async () => {
    // The trap in every hand-rolled version of this: `if (v) setValue(v)`, which cannot tell an
    // empty query parameter from an absent one.
    function Empty() {
      const v = useBrowserValue<string>(() => '', 'not-read-yet')
      return <p data-testid="v">[{v}]</p>
    }
    render(<Empty />)
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('[]'))
  })

  it('useHydrated is false on the first render and true after', async () => {
    const seen: string[] = []
    function Recorded() {
      const label = useHydrated() ? 'client' : 'server-or-first-paint'
      seen.push(label)
      return <p data-testid="v">{label}</p>
    }
    render(<Recorded />)
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('client'))
    expect(seen[0], 'the first pass must not claim to be the client').toBe('server-or-first-paint')
  })
})
