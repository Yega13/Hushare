// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { LocaleProvider } from '@/i18n/LocaleProvider'
import { en } from '@/i18n/dictionaries/en'
import OptionalPanel from '@/components/OptionalPanel'
import { boundedContext } from '@/lib/error-context'

// A PANEL CRASH, DRIVEN THROUGH THE REAL REPORT-ERROR AND READ OFF THE REQUEST IT SENDS.
//
// tests/optional-panel.test.tsx mocks the sink. This file does not, because what matters here is what
// report-error does with what the panel hands it: recognise a DOM that Chrome's translator rewrote,
// collect its forensics, file a translated page at warn -- and NOT reload a page whose album is still
// on screen, which is the reload report-error reserves for a page that is already dead.
//
// report-error keeps a per-page-load dedupe by source and message, so every test throws a different
// message: a repeat would be silently dropped and prove nothing.

type Sent = { source: string; message: string; level: string; context: Record<string, unknown> }
let sent: Sent[] = []
const DOM_RELOAD_FLAG = 'hush-dom-reloaded'
const NEWLINE = String.fromCharCode(10)

beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)) as Sent)
    return new Response(null, { status: 204 })
  }))
  sessionStorage.clear()
  document.documentElement.className = ''
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.documentElement.className = ''
})

function Throws({ error }: { error: Error }): never {
  throw error
}

const page = (child: React.ReactNode) => render(
  <LocaleProvider locale="en" dict={en}>
    <p>the album the guest came for</p>
    <OptionalPanel part="upload" onRetry={() => {}}>{child}</OptionalPanel>
  </LocaleProvider>,
)

describe('a panel crash reaches report-error in words it can act on', () => {
  it('TRANSLATED PAGE: forensics collected, filed at warn, and the album is NOT reloaded', () => {
    document.documentElement.className = 'translated-ltr'
    page(<Throws error={new Error("Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.")} />)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ source: 'optional:upload', level: 'warn', context: { translated: true } })
    expect(sessionStorage.getItem(DOM_RELOAD_FLAG), 'the DOM reload is for a dead page; this album is on screen').toBeNull()
  })

  it('UNTRANSLATED PAGE: still an error, still with forensics, still no reload', () => {
    page(<Throws error={new Error("Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.")} />)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ source: 'optional:upload', level: 'error' })
    expect(sent[0].context.translated).toBe(false)
    expect(sessionStorage.getItem(DOM_RELOAD_FLAG)).toBeNull()
  })

  it("the worst crash report -- deep component tree, long stack, translated page -- fits the log route's context limit", () => {
    // The route drops the WHOLE context when it is too large (lib/error-context), which would erase
    // the stack, the component and the forensics together.
    function Deep({ n }: { n: number }): React.ReactElement {
      if (n === 0) {
        const error = new Error('The object can not be found here.')
        error.stack = ['Error: The object can not be found here.', ...Array.from({ length: 12 }, (_, i) =>
          `    at Component${i} (https://hushare.space/_next/static/chunks/0123456789abcdef.js:1:${100000 + i})`)].join(NEWLINE)
        throw error
      }
      return <Deep n={n - 1} />
    }
    document.documentElement.className = 'translated-ltr'
    page(<Deep n={40} />)
    expect(sent).toHaveLength(1)
    expect(typeof sent[0].context.componentStack).toBe('string')
    expect((sent[0].context.componentStack as string).length).toBeLessThanOrEqual(200)
    expect(boundedContext(sent[0].context), 'the route would store no context at all').not.toBeNull()
  })
})
