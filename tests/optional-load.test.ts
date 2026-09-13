// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { optionalLoadFailure, shouldReloadForOptional, OPTIONAL_PARTS, DETAIL_MAX, COMPONENT_STACK_MAX } from '@/lib/optional-load'
// The REAL rules, not copies of their patterns (rule 17). If report-error's idea of a chunk failure or
// of a rewritten DOM ever changes, these assertions move with it.
import { looksLikeStaleDeploy, looksLikeDomCorruption } from '@/lib/report-error'

// WHAT AN OPTIONAL PART'S FAILURE DOES, AND WHAT IT REPORTS.
//
// The chunk messages below are verbatim from production rows. Reported as themselves, each matches
// report-error's chunk pattern, which answers by reloading the page.

const NEWLINE = String.fromCharCode(10)
const QR_ROW = new Error('ChunkLoadError: Failed to load chunk /_next/static/chunks/1vfl_aeamxgqu.js from module 73378')
const UPLOAD_ROW = new Error('Failed to load chunk /_next/static/chunks/2dycde-otmjsa.js from module 81276')
const COMPONENT_BUG = new TypeError("Cannot read properties of undefined (reading 'map')")
/** Chrome's translator rewriting text nodes under React, verbatim from the 2026-08-29 rows. */
const DOM_ROW = new Error("Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.")
/** A crash whose NAME is chunk words and whose message is not. Turbopack names its error ChunkLoadError. */
const NAMED_CHUNK = Object.assign(new Error('x is not a function'), { name: 'ChunkLoadError' })
const FRAMES = [
  '    at UploadZone (https://hushare.space/_next/static/chunks/abc.js:1:200)',
  '    at OptionalPanel (https://hushare.space/_next/static/chunks/abc.js:1:900)',
]
const BUG_WITH_STACK = Object.assign(new TypeError("Cannot read properties of undefined (reading 'map')"), {
  stack: ["TypeError: Cannot read properties of undefined (reading 'map')", ...FRAMES].join(NEWLINE),
})
const EVERY_ERROR: unknown[] = [QR_ROW, UPLOAD_ROW, COMPONENT_BUG, DOM_ROW, NAMED_CHUNK, BUG_WITH_STACK, 'network went away']
const PANELS = OPTIONAL_PARTS.filter((p) => p !== 'qr')

describe('optionalLoadFailure -- a part whose code would not load', () => {
  it('the production messages WOULD trigger a reload if reported as themselves -- the premise', () => {
    // If this ever stops being true, the rule below is protecting nothing and should be revisited.
    expect(looksLikeStaleDeploy(QR_ROW.message)).toBe(true)
    expect(looksLikeStaleDeploy(UPLOAD_ROW.message)).toBe(true)
  })

  it('NEVER reports in words that trigger the stale-deploy reload, for any part, any failure, reloading or not', () => {
    for (const part of OPTIONAL_PARTS) {
      for (const error of EVERY_ERROR) {
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

  it('groups: one stable sentence per part, whatever the chunk error said', () => {
    expect(optionalLoadFailure('qr', QR_ROW).message).toBe(optionalLoadFailure('qr', new Error('Loading chunk 123 failed.')).message)
    expect(optionalLoadFailure('qr', QR_ROW).message).toBe('Optional part could not load: qr')
    expect(optionalLoadFailure('upload', UPLOAD_ROW).message).toBe('Optional part could not load: upload')
  })

  it('names the part in the source, for a load failure and a crash alike', () => {
    for (const part of OPTIONAL_PARTS) {
      expect(optionalLoadFailure(part, UPLOAD_ROW).source).toBe(`optional:${part}`)
      expect(optionalLoadFailure(part, COMPONENT_BUG).source).toBe(`optional:${part}`)
    }
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
    // The NUMBER, not the constant: a test reading DETAIL_MAX cannot notice DETAIL_MAX changing.
    expect(DETAIL_MAX).toBe(200)
    const long = optionalLoadFailure('designer', new Error('Failed to load chunk ' + 'x'.repeat(250)))
    expect((long.context as { detail: string }).detail).toHaveLength(200)
    expect(optionalLoadFailure('face-finder', 'Failed to load chunk /_next/static/chunks/a.js').context)
      .toEqual({ cause: 'string', detail: 'Failed to load chunk /_next/static/chunks/a.js' })
  })
})

describe('optionalLoadFailure -- a part that loaded and then threw', () => {
  it('is reported as a CRASH, in its own words, so each distinct bug gets its own row', () => {
    expect(optionalLoadFailure('upload', COMPONENT_BUG).message).toBe("Optional part crashed: upload: Cannot read properties of undefined (reading 'map')")
    expect(optionalLoadFailure('face-finder', 'network went away').message).toBe('Optional part crashed: face-finder: network went away')
  })

  it("keeps the stack's frames and the component that threw -- what the route boundary used to send", () => {
    const componentStack = NEWLINE + '    at UploadZone (x.js:1:1)' + NEWLINE + '    at OptionalPanel (x.js:2:2)'
    expect(optionalLoadFailure('upload', BUG_WITH_STACK, false, componentStack).context).toEqual({
      cause: 'TypeError',
      stack: FRAMES.join(NEWLINE),
      componentStack: 'at UploadZone (x.js:1:1)' + NEWLINE + '    at OptionalPanel (x.js:2:2)',
    })
    expect(optionalLoadFailure('face-finder', 'network went away').context).toEqual({ cause: 'string' })
  })

  it('bounds the component stack at 200 characters, so the log route does not drop the whole context', () => {
    expect(COMPONENT_STACK_MAX).toBe(200)
    const report = optionalLoadFailure('upload', COMPONENT_BUG, false, 'y'.repeat(500))
    expect((report.context as { componentStack: string }).componentStack).toHaveLength(200)
  })

  it('a crash in a panel is an error; a crash in the QR code is a warning', () => {
    for (const part of PANELS) expect(optionalLoadFailure(part, COMPONENT_BUG).level, part).toBe('error')
    expect(optionalLoadFailure('qr', COMPONENT_BUG).level).toBe('warn')
  })

  it("a DOM rewritten under React reaches report-error in words its DOM rule recognises", () => {
    // Before, every crash was filed under the load sentence, and report-error -- which reads the
    // message -- never learned that a translated page had been rewritten under the panel.
    expect(looksLikeDomCorruption(optionalLoadFailure('upload', DOM_ROW).message)).toBe(true)
    expect(looksLikeDomCorruption(optionalLoadFailure('upload', new Error('The object can not be found here.')).message)).toBe(true)
  })

  it('never marks itself fatal -- the album is still on screen, so report-error must not reload it', () => {
    for (const part of OPTIONAL_PARTS) {
      for (const error of EVERY_ERROR) {
        for (const reloading of [false, true]) {
          expect(optionalLoadFailure(part, error, reloading).fatal, `${part}`).toBeUndefined()
        }
      }
    }
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
    // A reload fixes a stale deploy. It does not fix a bug or a translator, and would lose the guest's
    // place for nothing.
    for (const part of PANELS) {
      for (const error of [COMPONENT_BUG, DOM_ROW, NAMED_CHUNK]) {
        expect(shouldReloadForOptional(part, error, true), part).toBe(false)
      }
    }
  })
})
