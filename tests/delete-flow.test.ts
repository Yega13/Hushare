import { describe, it, expect } from 'vitest'
import { deleteFlowNext, deleteTapSends, DELETE_IDLE, type DeleteFlow } from '@/lib/delete-flow'

// THE TWO-TAP DELETE: every transition, and every event that must be ignored.

const step = (flow: DeleteFlow, ...events: Parameters<typeof deleteFlowNext>[1][]) => events.reduce(deleteFlowNext, flow)

describe('the happy path', () => {
  it('first tap asks for confirmation and sends nothing', () => {
    const f = step(DELETE_IDLE, { type: 'tap' })
    expect(f).toEqual({ phase: 'confirm', error: '' })
    expect(deleteTapSends(DELETE_IDLE)).toBe(false)
    expect(deleteTapSends(f)).toBe(true)
  })
  it('second tap is the request; success is the deleted state with the bin window', () => {
    const f = step(DELETE_IDLE, { type: 'tap' }, { type: 'tap' })
    expect(f).toEqual({ phase: 'deleting' })
    expect(step(f, { type: 'succeeded', restorableForDays: 7 })).toEqual({ phase: 'deleted', restorableForDays: 7 })
  })
})

describe('the ways out', () => {
  it('cancel from the confirm step returns to idle', () => {
    expect(step(DELETE_IDLE, { type: 'tap' }, { type: 'cancel' })).toEqual(DELETE_IDLE)
  })
  it('a failed request returns to the CONFIRM step carrying the reason -- the owner can read it and tap again', () => {
    const f = step(DELETE_IDLE, { type: 'tap' }, { type: 'tap' }, { type: 'failed', error: 'Could not delete the album' })
    expect(f).toEqual({ phase: 'confirm', error: 'Could not delete the album' })
    expect(deleteTapSends(f)).toBe(true)
  })
  it('tapping again after a failure clears the reason', () => {
    const f = step(DELETE_IDLE, { type: 'tap' }, { type: 'tap' }, { type: 'failed', error: 'x' }, { type: 'tap' })
    expect(f).toEqual({ phase: 'deleting' })
  })
})

describe('events that must be ignored', () => {
  it('a tap while the request is in flight does not send twice', () => {
    const deleting: DeleteFlow = { phase: 'deleting' }
    expect(step(deleting, { type: 'tap' })).toBe(deleting)
    expect(deleteTapSends(deleting)).toBe(false)
  })
  it('nothing moves a deleted album out of deleted -- the only exits are the restore button and leaving', () => {
    const deleted: DeleteFlow = { phase: 'deleted', restorableForDays: 7 }
    for (const e of [{ type: 'tap' }, { type: 'cancel' }, { type: 'failed', error: 'x' }, { type: 'succeeded', restorableForDays: 1 }] as const) {
      expect(step(deleted, e)).toBe(deleted)
    }
  })
  it('cancel, success and failure mean nothing from idle', () => {
    for (const e of [{ type: 'cancel' }, { type: 'failed', error: 'x' }, { type: 'succeeded', restorableForDays: 7 }] as const) {
      expect(step(DELETE_IDLE, e)).toBe(DELETE_IDLE)
    }
  })
  it('a late success or failure after cancelling is ignored', () => {
    expect(step(DELETE_IDLE, { type: 'tap' }, { type: 'cancel' }, { type: 'succeeded', restorableForDays: 7 })).toEqual(DELETE_IDLE)
  })
})
