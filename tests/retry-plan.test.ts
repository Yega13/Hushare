import { describe, it, expect } from 'vitest'
import { freshEntryFor, mergeWall, queuePendingRows, retryMode, shouldPark, wallFor, type FileStatus } from '@/lib/upload/retry-plan'

// WHAT A RETRY MEANS. The headline case is the duplicate: a file whose bytes are already in R2 and
// whose row is waiting for "Finish saving" must be RE-SAVED, never re-uploaded.

const entry = (status: FileStatus, autoResumed?: boolean) => ({ id: 'e1', status, progress: 42, error: 'boom', autoResumed })

describe('retryMode -- the duplicate-photo bug', () => {
  it('an entry whose row is already queued for saving is RE-SAVED, not re-uploaded', () => {
    expect(retryMode('e1', new Set(['e1']))).toBe('resave')
  })
  it('an entry with no queued row is re-uploaded', () => {
    expect(retryMode('e1', new Set(['e2']))).toBe('reupload')
    expect(retryMode('e1', new Set())).toBe('reupload')
  })
})

describe('shouldPark -- one automatic resume per file', () => {
  it('a recoverable failure parks a file that has not been resumed yet', () => {
    expect(shouldPark(true, entry('error'))).toBe(true)
  })
  it('a SECOND recoverable failure is a real error, not another park', () => {
    expect(shouldPark(true, entry('error', true))).toBe(false)
  })
  it('an unrecoverable failure never parks, resumed or not', () => {
    expect(shouldPark(false, entry('error'))).toBe(false)
    expect(shouldPark(false, entry('error', true))).toBe(false)
  })
})

describe('freshEntryFor -- what a retry starts from', () => {
  it('a parked tile tapped by hand SPENDS the one resume (it only skipped the wait)', () => {
    expect(freshEntryFor(entry('waiting'), 'tap')?.autoResumed).toBe(true)
  })
  it('a failed tile tapped by hand EARNS a fresh resume, even after one was spent', () => {
    expect(freshEntryFor(entry('error', true), 'tap')?.autoResumed).toBe(false)
  })
  it('the failed chip earns a fresh resume too', () => {
    expect(freshEntryFor(entry('error', true), 'chip')?.autoResumed).toBe(false)
  })
  it('the automatic resume spends it (it acts on what is parked)', () => {
    expect(freshEntryFor(entry('waiting'), 'auto')?.autoResumed).toBe(true)
  })
  it('the retry clears the old failure and starts from zero, keeping everything else', () => {
    const fresh = freshEntryFor({ ...entry('error'), videoResume: { uploadUrl: 'u' } }, 'tap')
    expect(fresh).toMatchObject({ id: 'e1', status: 'pending', progress: 0, error: undefined, videoResume: { uploadUrl: 'u' } })
  })
  it('nothing else is retryable: pending, uploading and done return null', () => {
    for (const s of ['pending', 'uploading', 'done'] as const) expect(freshEntryFor(entry(s), 'tap'), s).toBeNull()
  })
  it('each trigger has its own subject: the chip never touches a parked file, the auto never a failed one', () => {
    // A parked tile is about to upload itself; listing it as something to act on is the lie the
    // 'waiting' status exists to prevent. And the auto resume acts on exactly what is parked.
    expect(freshEntryFor(entry('waiting'), 'chip')).toBeNull()
    expect(freshEntryFor(entry('error'), 'auto')).toBeNull()
    expect(freshEntryFor(entry('error'), 'chip')?.status).toBe('pending')
    expect(freshEntryFor(entry('waiting'), 'auto')?.status).toBe('pending')
    expect(freshEntryFor(entry('waiting'), 'tap')?.status).toBe('pending')
    expect(freshEntryFor(entry('error'), 'tap')?.status).toBe('pending')
  })
})

describe('wallFor and mergeWall -- which banner a refused save puts up', () => {
  it('a full album only OFFERS AN ACCOUNT when the server said registering helps', () => {
    expect(wallFor('album_full', 'register')).toBe('full')
    expect(wallFor('album_full', undefined)).toBe('fullOther')
    expect(wallFor('album_full', 'upgrade')).toBe('fullOther')
  })
  it('any other refusal is a plain failure', () => {
    expect(wallFor(undefined, 'register')).toBe('failed')
    expect(wallFor('rate_limited', undefined)).toBe('failed')
  })
  it('full outranks everything, fullOther outranks failed, and neither is demoted', () => {
    expect(mergeWall('full', 'failed')).toBe('full')
    expect(mergeWall('full', 'fullOther')).toBe('full')
    expect(mergeWall('fullOther', 'failed')).toBe('fullOther')
    expect(mergeWall('fullOther', 'full')).toBe('full')
    expect(mergeWall('failed', 'full')).toBe('full')
    expect(mergeWall('failed', 'fullOther')).toBe('fullOther')
    expect(mergeWall(null, 'failed')).toBe('failed')
  })
})

describe('queuePendingRows -- each file waits once', () => {
  it('a second refusal for the same file replaces its pair instead of adding one', () => {
    const q = queuePendingRows([{ entryId: 'a', row: 1 }], [{ entryId: 'a', row: 2 }, { entryId: 'b', row: 3 }])
    expect(q).toEqual([{ entryId: 'a', row: 2 }, { entryId: 'b', row: 3 }])
  })
  it('the queue keeps the order files joined it', () => {
    const q = queuePendingRows([{ entryId: 'a' }, { entryId: 'b' }], [{ entryId: 'c' }])
    expect(q.map((p) => p.entryId)).toEqual(['a', 'b', 'c'])
  })
  it('a file refused AGAIN holds its place in the queue instead of moving to the end', () => {
    // The case the function exists for. A filter-and-append implementation passes every other
    // test here and quietly reorders the banner on every second refusal.
    const q = queuePendingRows([{ entryId: 'a' }, { entryId: 'b' }, { entryId: 'c' }], [{ entryId: 'b', row: 2 }])
    expect(q.map((p) => p.entryId)).toEqual(['a', 'b', 'c'])
    expect(q[1]).toEqual({ entryId: 'b', row: 2 })
  })
  it('the existing queue is not mutated: the caller reads the array it captured', () => {
    // retryBlockedRows captures the queue, awaits a save for up to 180 s, then decides which
    // entries were in THAT request from the captured array. An in-place push during the flight
    // would give a green tick to a photo whose row was never sent.
    const existing = [{ entryId: 'a' }]
    const q = queuePendingRows(existing, [{ entryId: 'b' }])
    expect(q).not.toBe(existing)
    expect(existing).toEqual([{ entryId: 'a' }])
  })
  it('nothing incoming leaves the queue as it was', () => {
    expect(queuePendingRows([{ entryId: 'a' }], [])).toEqual([{ entryId: 'a' }])
  })
})
