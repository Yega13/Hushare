import { describe, it, expect } from 'vitest'
import { classifyResolve } from '../src/lib/resolve-outcome'

// WHAT THE RESOLVE ANSWER MEANS. The order of the branches is the bug this exists to hold shut:
// a 404 that also says password_required must be "not found", never a password prompt.

const GATE = { slug: 'race', title: 'Race' }

describe('classifyResolve -- the order', () => {
  it('a 404 carrying password_required is NOT FOUND, not a gate (the infinite prompt)', () => {
    expect(classifyResolve(404, false, { password_required: true, ...GATE })).toEqual({ kind: 'not-found' })
  })
  it('a 404 carrying a reveal gate is not found either', () => {
    expect(classifyResolve(404, false, { locked: true, reveal_at: '2026-10-01T00:00:00Z', ...GATE })).toEqual({ kind: 'not-found' })
  })
  it('a refused status is a transient error even with a well-formed album body', () => {
    expect(classifyResolve(500, false, { id: 'a1', ...GATE })).toEqual({ kind: 'error' })
    expect(classifyResolve(503, false, { password_required: true, ...GATE })).toEqual({ kind: 'error' })
  })
})

describe('classifyResolve -- the gates', () => {
  it('200 with password_required and a name is the password gate', () => {
    expect(classifyResolve(200, true, { password_required: true, ...GATE })).toEqual({ kind: 'password', ...GATE })
  })
  it('a password gate missing its title or slug is a malformed answer, not a gate with "undefined" on it', () => {
    expect(classifyResolve(200, true, { password_required: true, slug: 'race' })).toEqual({ kind: 'error' })
    expect(classifyResolve(200, true, { password_required: true, title: 'Race' })).toEqual({ kind: 'error' })
    expect(classifyResolve(200, true, { password_required: true, slug: 1, title: 'Race' })).toEqual({ kind: 'error' })
  })
  it('200 with locked and a reveal time is the reveal gate', () => {
    expect(classifyResolve(200, true, { locked: true, reveal_at: '2026-10-01T00:00:00Z', ...GATE }))
      .toEqual({ kind: 'reveal', revealAt: '2026-10-01T00:00:00Z', ...GATE })
  })
  it('locked without a reveal time is not a gate; with no id it is an error', () => {
    expect(classifyResolve(200, true, { locked: true, ...GATE })).toEqual({ kind: 'error' })
    expect(classifyResolve(200, true, { locked: true, reveal_at: '', ...GATE })).toEqual({ kind: 'error' })
  })
  it('a reveal time that is not a string is a malformed answer, even with an album id beside it', () => {
    expect(classifyResolve(200, true, { locked: true, reveal_at: 123, id: 'a1', ...GATE })).toEqual({ kind: 'error' })
    expect(classifyResolve(200, true, { locked: true, reveal_at: {}, id: 'a1', ...GATE })).toEqual({ kind: 'error' })
  })
  it('the flags are literal true, not merely truthy (the route sends booleans)', () => {
    expect(classifyResolve(200, true, { password_required: 'true', id: 'a1' }).kind).toBe('album')
    expect(classifyResolve(200, true, { locked: 1, reveal_at: '2026-10-01T00:00:00Z', id: 'a1' }).kind).toBe('album')
  })
  it('a reveal gate missing its name is an error', () => {
    expect(classifyResolve(200, true, { locked: true, reveal_at: '2026-10-01T00:00:00Z', slug: 'race' })).toEqual({ kind: 'error' })
  })
  it('password_required wins over locked when both are set', () => {
    expect(classifyResolve(200, true, { password_required: true, locked: true, reveal_at: 'x', ...GATE }).kind).toBe('password')
  })
})

describe('classifyResolve -- the album', () => {
  it('200 with a string id is the album, handed through untouched', () => {
    const body = { id: 'a1', ...GATE, media_radius: 16 }
    const r = classifyResolve(200, true, body)
    expect(r.kind).toBe('album')
    if (r.kind === 'album') expect(r.album).toBe(body)
  })
  it('200 with a numeric id, an empty body, or no body is a malformed answer', () => {
    expect(classifyResolve(200, true, { id: 7 })).toEqual({ kind: 'error' })
    expect(classifyResolve(200, true, {})).toEqual({ kind: 'error' })
    expect(classifyResolve(200, true, null)).toEqual({ kind: 'error' })
    expect(classifyResolve(200, true, 'text')).toEqual({ kind: 'error' })
  })
})
