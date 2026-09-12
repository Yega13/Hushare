// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'
import { useOnValueChange } from '@/lib/use-on-value-change'

// THE LIGHTBOX MOVES TO ANOTHER PHOTO AND EVERYTHING ABOUT THE OLD ONE MUST GO.
//
// The behaviour is asserted through the DOM, because that is where the defect this replaces was
// visible: an effect commits the old state first, so there is one frame showing the previous
// photo's zoom on the new photo. What cannot be seen from outside -- that no effect is involved at
// all -- is pinned at the source, the same trade as tests/use-draft-of.test.tsx.

afterEach(cleanup)

let setZoomOutside: ((v: number) => void) | null = null

function Viewer({ id }: { id: string }) {
  const [zoom, setZoom] = useState(1)
  useOnValueChange(id, () => { setZoom(1) })
  return (
    <p data-testid="v" onClick={() => { setZoomOutside = setZoom }}>{`${id}@${zoom}`}</p>
  )
}

const shown = () => screen.getByTestId('v').textContent
const grabSetter = () => { act(() => { screen.getByTestId('v').click() }); return setZoomOutside }

describe('adjusting state when a value changes', () => {
  it('does nothing on the first render', () => {
    render(<Viewer id="a" />)
    expect(shown()).toBe('a@1')
  })

  it('leaves the state alone while the value stays put', () => {
    const { rerender } = render(<Viewer id="a" />)
    const setZoom = grabSetter()
    act(() => setZoom?.(3))
    expect(shown()).toBe('a@3')
    rerender(<Viewer id="a" />)
    expect(shown(), 'a re-render with the same value must not reset anything').toBe('a@3')
  })

  it('RESETS when the value changes, with no frame showing the old state', () => {
    const { rerender } = render(<Viewer id="a" />)
    const setZoom = grabSetter()
    act(() => setZoom?.(3))
    rerender(<Viewer id="b" />)
    // If this were an effect, the DOM would hold "b@3" until the effect ran.
    expect(shown()).toBe('b@1')
  })

  it('hands the callback the previous value as well as the next', () => {
    const seen: Array<[string, string]> = []
    function Watcher({ id }: { id: string }) {
      const [, force] = useState(0)
      useOnValueChange(id, (next, previous) => { seen.push([next, previous]); force((n) => n + 1) })
      return <p data-testid="v">{id}</p>
    }
    const { rerender } = render(<Watcher id="a" />)
    rerender(<Watcher id="b" />)
    rerender(<Watcher id="c" />)
    expect(seen).toEqual([['b', 'a'], ['c', 'b']])
  })

  it('fires once per change, not once per render', () => {
    let calls = 0
    function Counter({ id }: { id: string }) {
      const [n, setN] = useState(0)
      useOnValueChange(id, () => { calls++; setN(0) })
      return <p data-testid="v" onClick={() => setN((x) => x + 1)}>{`${id}:${n}`}</p>
    }
    const { rerender } = render(<Counter id="a" />)
    rerender(<Counter id="b" />)
    act(() => { screen.getByTestId('v').click() })
    rerender(<Counter id="b" />)
    expect(calls).toBe(1)
    expect(shown()).toBe('b:1')
  })

  it('does not loop when the value is unchanged but not identical by === (NaN)', () => {
    // `NaN !== NaN`, so a plain comparison restarts the render forever and the test HANGS rather
    // than failing -- which is why a measured dimension that failed is in here at all.
    function Measured({ w }: { w: number }) {
      const [resets, setResets] = useState(0)
      useOnValueChange(w, () => setResets((n) => n + 1))
      return <p data-testid="v">{`${w}:${resets}`}</p>
    }
    const { rerender } = render(<Measured w={NaN} />)
    rerender(<Measured w={NaN} />)
    expect(shown()).toBe('NaN:0')
  })
})

describe('it adjusts DURING render, not in an effect', () => {
  it('the module contains no effect at all', () => {
    const src = stripJsComments(readFileSync(join(process.cwd(), 'src', 'lib', 'use-on-value-change.ts'), 'utf8'))
    expect(src, 'this must not become an effect').not.toMatch(/useEffect|useLayoutEffect/)
    expect(src, 'the guard is what stops an infinite render').toContain('Object.is(value, seen)')
  })
})

describe('the two ways this hook is dangerous', () => {
  it('fires once per change under Strict Mode, where every render runs twice', () => {
    // React double-invokes render in Strict Mode. The callback is a setter, so a second invocation
    // is harmless -- but "once per change" was only ever proven for single-invoke rendering.
    let calls = 0
    function Counter({ id }: { id: string }) {
      const [n, setN] = useState(0)
      useOnValueChange(id, () => { calls++; setN((x) => x + 1) })
      return <p data-testid="s">{`${id}:${n}`}</p>
    }
    const { rerender } = render(<StrictMode><Counter id="a" /></StrictMode>)
    rerender(<StrictMode><Counter id="b" /></StrictMode>)
    expect(screen.getByTestId('s').textContent).toBe('b:1')
    expect(calls, 'a double-invoked render must not double the reset').toBe(1)
  })

  it('NO CALL SITE PASSES AN OBJECT OR ARRAY as the value -- that is an infinite render loop', () => {
    // A fresh object every render is never Object.is-equal to the last one, so the guard never
    // converges and the page hangs. The mutation set cannot catch this: the fault is at the caller.
    // Scanned as source because that is where the mistake would be made.
    const files: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue
        if (e.isDirectory()) walk(`${dir}/${e.name}`)
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(`${dir}/${e.name}`)
      }
    }
    walk('src')
    const bad: string[] = []
    let callers = 0
    for (const f of files) {
      const text = stripJsComments(readFileSync(join(process.cwd(), f), 'utf8'))
      for (const m of text.matchAll(/useOnValueChange\(\s*([[{])/g)) { bad.push(`${f}: starts with ${m[1]}`) }
      callers += (text.match(/useOnValueChange\(/g) ?? []).length
    }
    expect(bad, 'an object or array key never settles').toEqual([])
    // ...and the scan really found the call sites, rather than proving nothing.
    expect(callers, 'the walker found no callers at all').toBeGreaterThanOrEqual(5)
  })
})
