import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A BROWSER REWRITING OUR DOM IS NOT OUR ERROR, AND MUST NOT BE FILED AS ONE.
//
// Chrome's built-in page translation replaces text nodes wholesale. React then cannot find the
// children it placed and throws "Failed to execute 'removeChild' on 'Node'". This was a THEORY
// from 2026-08-17 and stayed one through nine occurrences, because nothing recorded the evidence.
//
// On 2026-08-29 the forensics caught it: translated: true, htmlLang "ja", on a page served in
// English — three reports inside two minutes from one session, plus a fourth as the error boundary
// itself tore down. There is no fix to make: React cannot survive a third party mutating its DOM,
// and the one-shot reload already recovers the page.
//
// What was left was an unfixable browser behaviour filing itself as an app error every time, which
// is how a panel of real problems turns into a panel nobody reads. It is recorded at warn instead
// — still visible if it ever becomes frequent, no longer counted as something we broke.
//
// This is pinned because the failure is silent in both directions: drop the downgrade and the
// panel refills with noise; drop it too broadly and a real DOM bug of ours hides in the warnings.
const source = readFileSync(join(process.cwd(), 'src', 'lib', 'report-error.ts'), 'utf8')

describe('client error reports separate our faults from the browser\'s', () => {
  it('downgrades DOM breakage that happened on a translated page', () => {
    expect(
      /const translatedDom = forensics\.translated === true/.test(source),
      'the translated flag from domForensics must decide the level, not just decorate the context',
    ).toBe(true)
    expect(
      /level: \(recoverable \|\| translatedDom\) \? 'warn'/.test(source),
      'a report from a translated page must be filed at warn, not error',
    ).toBe(true)
  })

  it('gathers the forensics once and uses that same result for both', () => {
    // Calling domForensics() twice would read the DOM at two different moments, and the level and
    // the evidence beside it could then disagree about what was on screen.
    expect(source.match(/domForensics\(\)/g)?.length, 'domForensics must be called exactly once at report time')
      .toBe(2)  // its declaration, and the single call site
  })

  it('still detects the message class it applies to', () => {
    // The downgrade hangs off looksLikeDomCorruption deciding to collect forensics at all. If that
    // stops matching, translatedDom is always false and the noise comes back silently.
    expect(/export function looksLikeDomCorruption/.test(source)).toBe(true)
    for (const phrase of ['removeChild', 'insertBefore']) {
      expect(source.includes(phrase), `looksLikeDomCorruption must still know about ${phrase}`).toBe(true)
    }
  })

  it('does not downgrade everything — a real error is still an error', () => {
    // Guard on the guard: if the level were hard-coded to warn this file would pass while the
    // error panel silently stopped reporting anything at all.
    expect(/\(input\.level \?\? 'error'\)/.test(source), 'the default level must still be error').toBe(true)
  })
})
