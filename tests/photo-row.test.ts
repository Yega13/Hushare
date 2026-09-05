import { describe, it, expect, vi } from 'vitest'
import { narrowPhotoRows } from '@/lib/photo-row'

// THE THREE COLUMNS A CAST USED TO HIDE, each with its own failure direction.
//
// The photo reads ended in `.returns<Photo[]>()`, which -- verified against postgrest-js -- checks
// array-ness and nothing else. So media_type, storage_backend and display_filter arrived as whatever
// the database held and were TYPED as the unions regardless. This is what replaced the cast, and
// each test below is a row the database can store that the old type said could not exist.

const good = {
  id: 'p1', album_id: 'a1', media_type: 'image', storage_backend: 'r2', display_filter: 'warm',
  url: 'https://x/1.jpg', created_at: '2026-09-05T00:00:00Z',
}

describe('a row the database can hold that the union denies', () => {
  it('passes a correct row through unchanged, and NARROWS its type', () => {
    const drop = vi.fn()
    const [p] = narrowPhotoRows([good], drop)
    expect(p).toEqual(good)
    expect(drop).not.toHaveBeenCalled()
    // The point of the function: these three are unions now, not string. A wrong assignment here is
    // a compile error, which is the check the cast was erasing.
    const mt: 'image' | 'video' = p.media_type
    const sb: 'r2' | 'stream' = p.storage_backend
    const df: 'warm' | 'none' | 'cool' | 'mono' | 'vintage' | 'soft' | null = p.display_filter
    expect([mt, sb, df]).toEqual(['image', 'r2', 'warm'])
  })

  it('DROPS and reports a row with an unknown media_type', () => {
    // Impossible today (the CHECK is exactly image|video), and the branch exists anyway: every
    // consumer branches on `=== 'video'`, so an unknown would render as an image with a video's
    // URLs -- a broken tile nobody could explain. Visible absence beats invisible breakage.
    const drop = vi.fn()
    const out = narrowPhotoRows([{ ...good, media_type: 'audio' }], drop)
    expect(out).toEqual([])
    expect(drop).toHaveBeenCalledWith({ id: 'p1', column: 'media_type', value: 'audio' })
  })

  it("DROPS and reports the pre-R2 'supabase' backend the CHECK still permits", () => {
    // Zero rows carry it and no code path writes it, and it is recorded as a deliberate narrowing
    // in lib/db-unions. If one ever appears, this is how you find out -- in the panel, not from a
    // guest.
    const drop = vi.fn()
    const out = narrowPhotoRows([{ ...good, storage_backend: 'supabase' }], drop)
    expect(out).toEqual([])
    expect(drop).toHaveBeenCalledWith({ id: 'p1', column: 'storage_backend', value: 'supabase' })
  })

  it('keeps the good rows from a mixed batch', () => {
    // Dropping the whole page because one row is bad would empty a grid over a single legacy row.
    const drop = vi.fn()
    const out = narrowPhotoRows([
      good,
      { ...good, id: 'p2', storage_backend: 'supabase' },
      { ...good, id: 'p3', media_type: 'video', storage_backend: 'stream' },
    ], drop)
    expect(out.map((p) => p.id)).toEqual(['p1', 'p3'])
    expect(drop).toHaveBeenCalledTimes(1)
  })

  it('COERCES an unknown display_filter to null instead of dropping the photo', () => {
    // A colour grade is cosmetic. Losing a guest's photograph over it would be absurd, so this one
    // errs the other way: render it, unfiltered.
    const drop = vi.fn()
    const [p] = narrowPhotoRows([{ ...good, display_filter: 'sepia' }], drop)
    expect(p.display_filter).toBeNull()
    expect(p.id).toBe('p1')
    expect(drop).not.toHaveBeenCalled()
  })

  it('leaves a null display_filter null', () => {
    const [p] = narrowPhotoRows([{ ...good, display_filter: null }], vi.fn())
    expect(p.display_filter).toBeNull()
  })

  it('accepts every value the database CHECK permits for display_filter', () => {
    for (const f of ['none', 'warm', 'cool', 'mono', 'vintage', 'soft']) {
      const [p] = narrowPhotoRows([{ ...good, display_filter: f }], vi.fn())
      expect(p.display_filter, f).toBe(f)
    }
  })

  it('is empty in, empty out', () => {
    const drop = vi.fn()
    expect(narrowPhotoRows([], drop)).toEqual([])
    expect(drop).not.toHaveBeenCalled()
  })
})
