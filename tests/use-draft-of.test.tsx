// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'
import { useDraftOf } from '@/lib/use-draft-of'

// THE FIELD SOMEBODY IS TYPING IN, WHOSE VALUE CAN ALSO CHANGE UNDERNEATH THEM.
//
// Two things have to hold at once and they pull against each other: while it is being edited the
// draft is the person's, halfway-valid and not to be overwritten by a re-render; and when the real
// value changes from elsewhere the draft must follow it.
//
// WHAT IS NOT ASSERTED HERE, AND WHY. The first version of this file counted renders, to show that
// following the source costs one pass rather than two. Every way of counting renders from inside a
// component -- a module variable, a captured object, a ref bumped during render -- is itself the
// thing react-hooks/globals, /immutability and /refs exist to forbid, and a test that breaks the
// rules the module exists to respect is not a demonstration of anything. The render count is also
// not observable from the outside: React restarts the render before committing, so there is no
// intermediate DOM state to catch.
//
// So the COUNT is pinned at the source instead -- this module must contain no effect -- and the
// behaviour is tested through the DOM. That is the same trade as every other source-reading
// assertion here: when a fact cannot be expressed as behaviour, read the real source (rule 13).

afterEach(cleanup)

let latestSetDraft: ((v: string) => void) | null = null

function Field({ value }: { value: string }) {
  const [draft, setDraft] = useDraftOf(value, (v) => `[${v}]`)
  // Captured through the returned setter rather than assigned during render: this runs in an
  // event, not in the render pass, so it is a handler like any other.
  return <p data-testid="d" onClick={() => { latestSetDraft = setDraft }}>{draft}</p>
}

const shown = () => screen.getByTestId('d').textContent
const grabSetter = () => { act(() => { screen.getByTestId('d').click() }); return latestSetDraft }

describe('a draft follows its source', () => {
  it('starts as the formatted source', () => {
    render(<Field value="red" />)
    expect(shown()).toBe('[red]')
  })

  it('keeps what was typed while the source stays put', () => {
    const { rerender } = render(<Field value="red" />)
    const setDraft = grabSetter()
    act(() => setDraft?.('#f'))
    expect(shown(), 'a half-typed value survives').toBe('#f')
    rerender(<Field value="red" />)
    expect(shown(), 'and survives a re-render with the same source').toBe('#f')
  })

  it('FOLLOWS the source when it changes from outside, discarding the draft', () => {
    const { rerender } = render(<Field value="red" />)
    const setDraft = grabSetter()
    act(() => setDraft?.('#f'))
    rerender(<Field value="blue" />)
    expect(shown()).toBe('[blue]')
  })

  it('never shows the stale draft once the source has moved', () => {
    // The failure the effect version had: it committed the old draft, ran the effect, then
    // rendered again -- so there was a frame showing a value that was no longer true.
    const { rerender } = render(<Field value="red" />)
    rerender(<Field value="green" />)
    expect(shown()).toBe('[green]')
  })

  it('does not loop when the source is unchanged but not identical by ===', () => {
    // Object.is, so NaN is stable. `NaN !== NaN` would restart the render forever, and the test
    // would hang rather than fail -- which is why this one is here at all.
    function NumField({ value }: { value: number }) {
      const [draft] = useDraftOf(value, (v) => String(v))
      return <p data-testid="d">{draft}</p>
    }
    const { rerender } = render(<NumField value={NaN} />)
    rerender(<NumField value={NaN} />)
    expect(shown()).toBe('NaN')
  })
})

describe('it follows the source DURING render, not in an effect', () => {
  it('the module contains no effect at all', () => {
    // The whole point. An effect would work and would cost a committed render with the stale draft
    // in it every time the source changes -- visible on a slider, and exactly what
    // react-hooks/set-state-in-effect flags. Not observable from outside React, so pinned here.
    // Comments stripped first: the module's own header explains why it is NOT an effect, and
    // says the word while doing so. Reading the raw text would match that prose and pass for the
    // wrong reason -- the exact hazard tests/helpers/source-text exists for.
    const src = stripJsComments(readFileSync(join(process.cwd(), 'src', 'lib', 'use-draft-of.ts'), 'utf8'))
    expect(src, 'this must not become an effect again').not.toMatch(/useEffect|useLayoutEffect/)
    expect(src, 'the adjustment is guarded, or it restarts forever').toContain('Object.is(source, seen)')
  })
})
