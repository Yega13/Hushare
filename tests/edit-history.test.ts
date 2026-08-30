import { describe, it, expect } from 'vitest'
import { historyReducer, HISTORY_CAP, type HistoryState } from '@/lib/edit-history'
import { parseFocalPoint, normalizeWelcomeMessage, WELCOME_MESSAGE_MAX, isValidHex, contrastText } from '@/lib/album-design'

// UNDO/REDO IS WHAT TWENTY MINUTES OF DESIGN WORK HANGS ON, and every failure here is silent:
// a blank canvas after one undo too many, a redo that resurrects an edit the user replaced, a
// history that grows a full canvas snapshot per keystroke until the tab dies. It ran inside the
// card editor with no test; it is generic and tested now.
type S = string
const h = (states: S[], idx: number): HistoryState<S> => ({ states, idx })

describe('an editor history behaves like a person expects', () => {
  it('push advances, undo steps back, redo returns', () => {
    let s = h(['a'], 0)
    s = historyReducer(s, { type: 'PUSH', state: 'b' })
    expect([s.states, s.idx]).toEqual([['a', 'b'], 1])
    s = historyReducer(s, { type: 'UNDO' })
    expect(s.states[s.idx]).toBe('a')
    s = historyReducer(s, { type: 'REDO' })
    expect(s.states[s.idx]).toBe('b')
  })

  it('NEVER steps past the beginning — the blank-canvas bug', () => {
    // One index too far and states[idx] is undefined: the canvas renders empty and the work looks
    // destroyed, in response to the user asking to go back one step.
    let s = h(['a'], 0)
    for (let i = 0; i < 5; i++) s = historyReducer(s, { type: 'UNDO' })
    expect(s.idx).toBe(0)
    expect(s.states[s.idx]).toBe('a')
  })

  it('never steps past the end either', () => {
    let s = h(['a', 'b'], 1)
    for (let i = 0; i < 5; i++) s = historyReducer(s, { type: 'REDO' })
    expect(s.states[s.idx]).toBe('b')
  })

  it('a new edit after undo DISCARDS the redo branch', () => {
    // The user undid to an earlier card and edited from there. The abandoned future must be gone:
    // redo bringing it back would overwrite what they consciously chose to build instead.
    let s = h(['a', 'b', 'c'], 2)
    s = historyReducer(s, { type: 'UNDO' })   // at b
    s = historyReducer(s, { type: 'PUSH', state: 'd' })
    expect(s.states).toEqual(['a', 'b', 'd'])
    s = historyReducer(s, { type: 'REDO' })
    expect(s.states[s.idx], 'redo must not resurrect c').toBe('d')
  })

  it('caps its memory, dropping the OLDEST snapshots', () => {
    // Each snapshot is a full canvas. Uncapped, a long session grows until the tab dies.
    let s = h(['0'], 0)
    for (let i = 1; i <= HISTORY_CAP + 20; i++) s = historyReducer(s, { type: 'PUSH', state: String(i) })
    expect(s.states.length).toBe(HISTORY_CAP)
    expect(s.states[s.states.length - 1], 'the newest survives').toBe(String(HISTORY_CAP + 20))
    expect(s.states[0], 'the oldest is what falls off').toBe(String(21))
    expect(s.idx).toBe(HISTORY_CAP - 1)
  })

  it('REPLACE resets to one state, so undo cannot cross a load', () => {
    // Loading a saved card replaces the world. Undoing "through" the load into the previous
    // session's states would splice two different cards together.
    let s = h(['a', 'b', 'c'], 2)
    s = historyReducer(s, { type: 'REPLACE', state: 'loaded' })
    expect(s).toEqual(h(['loaded'], 0))
    s = historyReducer(s, { type: 'UNDO' })
    expect(s.states[s.idx]).toBe('loaded')
  })
})

// THE DESIGNER'S PARSERS, moved to lib/album-design and held to their fallbacks.
describe('a stored focal point can never anchor the header off-canvas', () => {
  it('parses the format the designer writes', () => {
    expect(parseFocalPoint('25% 75%')).toEqual({ x: 25, y: 75 })
    expect(parseFocalPoint('0% 100%')).toEqual({ x: 0, y: 100 })
  })

  it('falls back to centre for anything else — the column is text and has seen formats', () => {
    for (const bad of [null, undefined, '', 'garbage', '25%75%', '25 75', '25.5% 75%', '-5% 20%']) {
      expect(parseFocalPoint(bad), JSON.stringify(bad)).toEqual({ x: 50, y: 50 })
    }
  })

  it('clamps three-digit values the regex admits', () => {
    // "999% 999%" matches \d{1,3} — unclamped it anchored the header to a point far outside the
    // image, which renders as the header stuck to one edge with no visible reason.
    expect(parseFocalPoint('999% 999%')).toEqual({ x: 100, y: 100 })
  })
})

describe('a welcome message is stored the way both the input and the save agree', () => {
  it('collapses pasted whitespace and trims', () => {
    expect(normalizeWelcomeMessage('  hello\n\n  world  ')).toBe('hello world')
  })

  it('caps at the same limit the input enforces', () => {
    expect(normalizeWelcomeMessage('a'.repeat(500))).toHaveLength(WELCOME_MESSAGE_MAX)
  })

  it('stores an effectively-empty message as null, so no empty bubble renders', () => {
    for (const empty of ['', '   ', '\n\t \n']) {
      expect(normalizeWelcomeMessage(empty)).toBeNull()
    }
  })
})

describe('the design validators already in the module hold', () => {
  it('accepts real hexes and refuses lookalikes', () => {
    expect(isValidHex('#630826')).toBe(true)
    for (const bad of ['630826', '#63082', '#6308261', '#gggggg', '']) {
      expect(isValidHex(bad), bad).toBe(false)
    }
  })

  it('picks readable text for light and dark backgrounds', () => {
    // The silent failure: a white title on a white background is a header that "disappeared".
    expect(contrastText('#FFFFFF')).not.toBe('#FFFFFF')
    expect(contrastText('#000000')).not.toBe('#000000')
  })
})
