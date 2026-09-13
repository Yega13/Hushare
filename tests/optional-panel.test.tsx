// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { LocaleProvider } from '@/i18n/LocaleProvider'
import { en } from '@/i18n/dictionaries/en'
import type { OptionalPart } from '@/lib/optional-load'

// A PANEL THAT WILL NOT LOAD, INSIDE A REAL ALBUM PAGE'S WORTH OF SIBLINGS.
//
// Before OptionalPanel, the upload panel's rejected chunk reached the route error boundary and the
// guest's whole album became "Something went wrong". These render the real component around a child
// that throws the production error verbatim, and assert what the guest is left with. The report sink
// is mocked here; tests/optional-panel-report.test.tsx runs the real one.

const reports: Array<Record<string, unknown>> = []
const reloads: number[] = []
const env = { reloadAvailable: true }

vi.mock('@/lib/report-error', async (orig) => ({
  // looksLikeStaleDeploy stays REAL: lib/optional-load decides with it.
  ...(await orig<typeof import('@/lib/report-error')>()),
  reportClientError: (input: Record<string, unknown>) => { reports.push(input) },
  reloadOnceForStaleDeploy: () => { reloads.push(1); return true },
  staleReloadStillAvailable: () => env.reloadAvailable,
}))

const { default: OptionalPanel } = await import('@/components/OptionalPanel')
const { failOptionalPart } = await import('@/lib/optional-load')

const UPLOAD_ROW = 'Failed to load chunk /_next/static/chunks/2dycde-otmjsa.js from module 81276'

function WontLoad({ message }: { message: string }): never {
  throw new Error(message)
}

function page(
  child: React.ReactNode,
  onRetry = () => {},
  { part = 'upload', floating = false }: { part?: OptionalPart; floating?: boolean } = {},
) {
  return render(
    <LocaleProvider locale="en" dict={en}>
      <p>the album the guest came for</p>
      <OptionalPanel part={part} floating={floating} onRetry={onRetry}>{child}</OptionalPanel>
    </LocaleProvider>,
  )
}

beforeEach(() => {
  reports.length = 0
  reloads.length = 0
  env.reloadAvailable = true
  // React reports every caught render error to the console. Expected here, and noise.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('OptionalPanel', () => {
  it('renders its panel, and reports nothing, when nothing goes wrong', () => {
    page(<p>upload panel</p>)
    expect(screen.getByText('upload panel')).toBeTruthy()
    expect(reports).toHaveLength(0)
  })

  it('THE RELOAD ALREADY SPENT: the album stays, the panel is replaced by one translated line, and it is reported as an error', () => {
    // The measured case. The first failure spent the reload, the chunk still would not load.
    env.reloadAvailable = false
    page(<WontLoad message={UPLOAD_ROW} />)
    expect(screen.getByText('the album the guest came for'), 'a failed panel must not take the album with it').toBeTruthy()
    expect(screen.getByText(en['common.errorGeneric'])).toBeTruthy()
    expect(reloads, 'a spent reload must not be spent again').toHaveLength(0)
    expect(reports).toEqual([{
      source: 'optional:upload',
      message: 'Optional part could not load: upload',
      level: 'error',
      context: { cause: 'Error', detail: UPLOAD_ROW },
    }])
    // An ordinary panel's fallback sits where the panel was.
    expect(screen.getByRole('alert').style.position).toBe('')
  })

  it('the reload still available: a stale deploy heals itself, reported as a warning that reloaded', () => {
    page(<WontLoad message={UPLOAD_ROW} />)
    expect(reloads, 'a real stale deploy must still reload once').toHaveLength(1)
    expect(reports[0]).toMatchObject({ source: 'optional:upload', level: 'warn', context: { autoReloaded: true } })
  })

  it('a panel with an ordinary bug is contained, never reloaded, and reported AS A CRASH with the component that threw', () => {
    page(<WontLoad message="Cannot read properties of undefined (reading 'map')" />)
    expect(reloads).toHaveLength(0)
    expect(screen.getByText('the album the guest came for')).toBeTruthy()
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      source: 'optional:upload',
      message: "Optional part crashed: upload: Cannot read properties of undefined (reading 'map')",
      level: 'error',
    })
    const context = reports[0].context as Record<string, unknown>
    expect(context.cause).toBe('Error')
    expect(typeof context.stack).toBe('string')
    expect(typeof context.componentStack, "React's component stack must reach the report").toBe('string')
  })

  it("the guest's retry is wired to the fallback", () => {
    env.reloadAvailable = false
    const onRetry = vi.fn()
    page(<WontLoad message={UPLOAD_ROW} />, onRetry)
    fireEvent.click(screen.getByText(en['common.errorGeneric']))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('THE DESIGNER FLOATS: its fallback is fixed at the top of the screen, above the Settings sheet', () => {
    // AlbumDesigner is a full-screen overlay opened from the Settings sheet. Its place in the page is
    // below the photo grid, so an ordinary fallback appeared nowhere near the button the owner tapped.
    env.reloadAvailable = false
    page(<WontLoad message={UPLOAD_ROW} />, () => {}, { part: 'designer', floating: true })
    const alert = screen.getByRole('alert')
    expect(alert.style.position).toBe('fixed')
    expect(alert.style.zIndex).toBe('400')
    expect(reports[0]).toMatchObject({ source: 'optional:designer' })
  })
})

describe('failOptionalPart -- for a handler that catches its own failure', () => {
  // The share menu's table-card download catches its own rejection; nothing renders a fallback, so
  // the caller needs to know whether the page is about to reload before it shows the owner anything.
  it('a load failure with the reload still available: reported at warn, reloads once, and says it is reloading', () => {
    expect(failOptionalPart('table-card', new Error(UPLOAD_ROW))).toBe(true)
    expect(reloads).toHaveLength(1)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ source: 'optional:table-card', level: 'warn', context: { autoReloaded: true } })
  })

  it('the reload already spent: reported as an error, no reload, and says so -- so the caller tells the owner', () => {
    env.reloadAvailable = false
    expect(failOptionalPart('table-card', new Error(UPLOAD_ROW))).toBe(false)
    expect(reloads).toHaveLength(0)
    expect(reports[0]).toMatchObject({ source: 'optional:table-card', level: 'error' })
  })

  it('a crash never reloads, is reported in its own words, and says the page is staying', () => {
    expect(failOptionalPart('table-card', new TypeError('pdf.addImage is not a function'))).toBe(false)
    expect(reloads).toHaveLength(0)
    expect(reports[0]).toMatchObject({ message: 'Optional part crashed: table-card: pdf.addImage is not a function', level: 'error' })
  })
})
