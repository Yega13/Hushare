// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { LocaleProvider } from '@/i18n/LocaleProvider'
import { en } from '@/i18n/dictionaries/en'

// A PANEL THAT WILL NOT LOAD, INSIDE A REAL ALBUM PAGE'S WORTH OF SIBLINGS.
//
// Before OptionalPanel, the upload panel's rejected chunk reached the route error boundary and the
// guest's whole album became "Something went wrong". These render the real component around a child
// that throws the production error verbatim, and assert what the guest is left with.

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

const UPLOAD_ROW = 'Failed to load chunk /_next/static/chunks/2dycde-otmjsa.js from module 81276'

function WontLoad({ message }: { message: string }): never {
  throw new Error(message)
}

function page(child: React.ReactNode, onRetry = () => {}) {
  return render(
    <LocaleProvider locale="en" dict={en}>
      <p>the album the guest came for</p>
      <OptionalPanel part="upload" onRetry={onRetry}>{child}</OptionalPanel>
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
  })

  it('the reload still available: a stale deploy heals itself, reported as a warning that reloaded', () => {
    page(<WontLoad message={UPLOAD_ROW} />)
    expect(reloads, 'a real stale deploy must still reload once').toHaveLength(1)
    expect(reports[0]).toMatchObject({ source: 'optional:upload', level: 'warn', context: { autoReloaded: true } })
  })

  it('a panel with an ordinary bug is contained and reported, never reloaded', () => {
    page(<WontLoad message="Cannot read properties of undefined (reading 'map')" />)
    expect(reloads).toHaveLength(0)
    expect(screen.getByText('the album the guest came for')).toBeTruthy()
    expect(reports[0]).toMatchObject({ level: 'error' })
  })

  it("the guest's retry is wired to the fallback", () => {
    env.reloadAvailable = false
    const onRetry = vi.fn()
    page(<WontLoad message={UPLOAD_ROW} />, onRetry)
    fireEvent.click(screen.getByText(en['common.errorGeneric']))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
