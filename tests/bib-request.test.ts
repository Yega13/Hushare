import { describe, it, expect } from 'vitest'
import { BIB_RESULT_LIMIT, BIB_TYPING_DEBOUNCE_MS, applyBibResponse, bibFailureTag, bibRequestPlan } from '../src/lib/bib-request'
import type { Photo } from '@/types'

// WHAT A BIB SEARCH ASKS AND WHAT ITS ANSWER MEANS.

const photo = (id: string) => ({ id }) as unknown as Photo

describe('bibRequestPlan', () => {
  it('digits are a LIMITED, debounced search for that album', () => {
    const p = bibRequestPlan('a1', '945')
    expect(p.kind).toBe('search')
    expect(p.delayMs).toBe(BIB_TYPING_DEBOUNCE_MS)
    expect(p.url).toBe(`/api/album/photos?albumId=a1&bib=945&limit=${BIB_RESULT_LIMIT}`)
    expect(BIB_RESULT_LIMIT).toBe(300)
    expect(BIB_TYPING_DEBOUNCE_MS, 'the debounce itself, not the code against itself (rule 17)').toBe(300)
  })
  it('an empty box asks for the index stats only, at once, and never for rows', () => {
    const p = bibRequestPlan('a1', '')
    expect(p.kind).toBe('stats')
    expect(p.delayMs).toBe(0)
    expect(p.url).toBe('/api/album/photos?albumId=a1&bibStats=1&statsOnly=1')
    expect(p.url).not.toContain('bib=')
  })
  it('a search never asks for the stats (two count scans per keystroke)', () => {
    expect(bibRequestPlan('a1', '12').url).not.toContain('bibStats')
  })
  it('the album id and the digits are URL-encoded', () => {
    expect(bibRequestPlan('a b', '1&2').url).toContain('albumId=a%20b&bib=1%262&')
  })
})

describe('applyBibResponse', () => {
  it('a stats-only reply carries stats and is NOT a result (never "no matches")', () => {
    const r = applyBibResponse('', { bibStats: { indexed: 10, totalImages: 12 } })
    expect(r.stats).toEqual({ indexed: 10, totalImages: 12 })
    expect(r.result).toBeNull()
    expect(r.retiresFailureFor).toBeNull()
  })
  it('a search reply is tagged with the digits it answers and keeps the TRUE total', () => {
    const r = applyBibResponse('945', { photos: [photo('p1'), photo('p2')], total: 1847 })
    expect(r.result).toEqual({ query: '945', photos: [photo('p1'), photo('p2')], total: 1847 })
  })
  it('a search reply with no total counts its rows; with no rows it is an EMPTY result, not null', () => {
    expect(applyBibResponse('945', { photos: [photo('p1')] }).result?.total).toBe(1)
    expect(applyBibResponse('945', {}).result).toEqual({ query: '945', photos: [], total: 0 })
  })
  it('a search success retires the failure tag for the same digits', () => {
    expect(applyBibResponse('3400', { photos: [] }).retiresFailureFor).toBe('3400')
  })
  it('stats riding along with a search reply are still taken', () => {
    expect(applyBibResponse('1', { photos: [], bibStats: { indexed: 1, totalImages: 1 } }).stats).toEqual({ indexed: 1, totalImages: 1 })
  })
})

describe('bibFailureTag', () => {
  it('a failed search is tagged with its digits; a failed stats request tags nothing', () => {
    expect(bibFailureTag('945')).toBe('945')
    expect(bibFailureTag('')).toBeNull()
  })
})
