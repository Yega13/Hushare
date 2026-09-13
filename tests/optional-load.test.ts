// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { optionalLoadFailure, shouldReloadForOptional, OPTIONAL_PARTS, DETAIL_MAX } from '@/lib/optional-load'
// The REAL reload predicate, not a copy of its pattern (rule 17). If report-error's idea of a chunk
// failure ever changes, these assertions move with it.
import { looksLikeStaleDeploy } from '@/lib/report-error'

// WHAT AN OPTIONAL PART'S FAILURE DOES, AND WHAT IT REPORTS.
//
// The two messages below are verbatim from production rows. Reported as themselves, each matches
// report-error's chunk pattern, which answers by reloading the page.

const QR_ROW = new Error('ChunkLoadError: Failed to load chunk /_next/static/chunks/1vfl_aeamxgqu.js from module 73378')
const UPLOAD_ROW = new Error('Failed to load chunk /_next/static/chunks/2dycde-otmjsa.js from module 81276')
const COMPONENT_BUG = new TypeError("Cannot read properties of undefined (reading 'map')")
const PANELS = OPTIONAL_PARTS.filter((p) => p !== 'qr')

describe('optionalLoadFailure -- what gets reported', () => {
  it('the production messages WOULD trigger a reload if reported as themselves -- the premise', () => {
    // If this ever stops being true, the rule below is protecting nothing and should be revisited.
    expect(looksLikeStaleDeploy(QR_ROW.message)).toBe(true)
    expect(looksLikeStaleDeploy(UPLOAD_ROW.message)).toBe(true)
  })

  it('NEVER reports in words that trigger the stale-deploy reload, for any part, reloading or not', () => {
    for (const part of OPTIONAL_PARTS) {
      for (const error of [QR_ROW, UPLOAD_ROW]) {
        for (const reloading of [false, true]) {
          const report = optionalLoadFailure(part, error, reloading)
          expect(looksLikeStaleDeploy(report.message), `${part}: "${report.message}" would reload the album`).toBe(false)
        }
      }
    }
  })

  it('keeps the original words, in context, where no reload rule reads them', () => {
    expect(optionalLoadFailure('upload', UPLOAD_ROW).context).toEqual({ cause: 'Error', detail: UPLOAD_ROW.message })
  })

  it('groups: one stable sentence per part, whatever the error said', () => {
    expect(optionalLoadFailure('qr', QR_ROW).message).toBe(optionalLoadFailure('qr', new Error('something else')).message)
    expect(optionalLoadFailure('qr', QR_ROW).message).toBe('Optional part could not load: qr')
    expect(optionalLoadFailure('upload', UPLOAD_ROW).message).toBe('Optional part could not load: upload')
  })

  it('names the part in the source', () => {
    for (const part of OPTIONAL_PARTS) expect(optionalLoadFailure(part, UPLOAD_ROW).source).toBe(`optional:${part}`)
  })

  it('a missing QR code is a warning; a panel that STAYS missing is an error', () => {
    expect(optionalLoadFailure('qr', QR_ROW).level).toBe('warn')
    for (const part of PANELS) {
      expect(optionalLoadFailure(part, UPLOAD_ROW).level, `${part} costs the guest the thing they came to do`).toBe('error')
    }
  })

  it('a failure being healed by the stale-deploy reload is a warning, and says it reloaded', () => {
    for (const part of PANELS) {
      const report = optionalLoadFailure(part, UPLOAD_ROW, true)
      expect(report.level, part).toBe('warn')
      expect(report.context, part).toEqual({ cause: 'Error', detail: UPLOAD_ROW.message, autoReloaded: true })
    }
  })

  it('bounds the kept detail at 200 characters, and copes with a rejection that is not an Error', () => {
    // The NUMBER, not the constant. `toHaveLength(DETAIL_MAX)` reads the value the code reads, so a
    // mutation raising it to 100000 stayed green -- the same mistake made, and fixed, in
    // tests/image-encode.test.ts earlier the same day.
    expect(DETAIL_MAX).toBe(200)
    const long = optionalLoadFailure('designer', new Error('x'.repeat(250)))
    expect((long.context as { detail: string }).detail).toHaveLength(200)
    expect(optionalLoadFailure('face-finder', 'network went away').context).toEqual({ cause: 'string', detail: 'network went away' })
  })
})

describe('shouldReloadForOptional -- spend the one reload, or contain', () => {
  it('a panel whose chunk failed, with the reload still available, RELOADS -- a real stale deploy heals itself', () => {
    for (const part of PANELS) expect(shouldReloadForOptional(part, UPLOAD_ROW, true), part).toBe(true)
  })

  it('ONCE THE RELOAD IS SPENT, IT CONTAINS -- the second failure no longer blanks the album', () => {
    // The measured case: the reload happened, the chunk still would not load. Reloading again is
    // exactly the loop the one-shot flag exists to stop.
    for (const part of PANELS) expect(shouldReloadForOptional(part, UPLOAD_ROW, false), part).toBe(false)
  })

  it('never reloads the album for a QR code, even with the reload available', () => {
    expect(shouldReloadForOptional('qr', QR_ROW, true)).toBe(false)
  })

  it('a panel that throws for any OTHER reason is contained, not reloaded', () => {
    // A reload fixes a stale deploy. It does not fix a bug, and would lose the guest's place for nothing.
    for (const part of PANELS) expect(shouldReloadForOptional(part, COMPONENT_BUG, true), part).toBe(false)
  })
})
