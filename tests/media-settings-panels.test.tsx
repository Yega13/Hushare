// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { useEffect, useState } from 'react'
import MediaSettingsPanels from '@/components/owner-toolbar/MediaSettingsPanels'
import { MEDIA_SAVE_TIMEOUT_MS } from '@/components/owner-toolbar/api'
import { APP_TOAST_EVENT } from '@/components/AppToast'
import { LocaleProvider } from '@/i18n/LocaleProvider'
import { en } from '@/i18n/dictionaries/en'
import type { Album } from '@/types'

// WHAT THE MEDIA PANEL PUTS ON THE WIRE, rendered for real with the album flowing back the way
// AlbumPageClient makes it flow: every onAlbumUpdated patch becomes the next album prop.
//
// A review found the baseline bug with exactly this rig: drag the radius (the album is patched
// optimistically so the grid redraws), flip autoplay inside the 500 ms debounce window, and the
// request carried the flip but NOT the radius -- while still resetting every per-photo radius
// override. The pure functions in lib/media-settings-diff each did what their tests said; the
// defect was which value the component fed them. So this test drives the component.

const ALBUM = {
  id: 'a1', slug: 'race', title: 'Race',
  media_radius: 16, video_autoplay: false, media_filter: 'none', mobile_grid_columns: 3,
  desktop_grid_columns: 6, slideshow_interval_ms: 4000, slideshow_animation: 'fade',
  photo_layout: 'grid',
} as unknown as Album

type Answer = { status: number; json: Record<string, unknown> }
type Sent = { body: Record<string, unknown>; release: (a: Answer) => void; reject: (e: unknown) => void; signal: AbortSignal | null | undefined }
const sent: Sent[] = []
/** HOLD MODE: requests stay open until a test releases them, so answers can land in any order and
 *  edits can be made while a request is out -- the shape both review findings had. */
let hold = false
/** What the route answers: by default it echoes back what it applied, exactly like the real one. */
const echo = (body: Record<string, unknown>): { status: number; json: Record<string, unknown> } => {
  const applied = { ...body }
  for (const k of ['slug', 'reset_radius_overrides', 'reset_filter_overrides']) delete applied[k]
  return { status: 200, json: applied }
}
let answer = echo
const fail = (): Answer => ({ status: 500, json: { error: 'nope' } })
const resolveOk = (i: number) => act(async () => { sent[i].release(echo(sent[i].body)); await Promise.resolve(); await Promise.resolve() })
const resolveFail = (i: number) => act(async () => { sent[i].release(fail()); await Promise.resolve(); await Promise.resolve() })
/** The browser gave up: what AbortSignal.timeout makes fetch reject with -- a DOMException named
 *  TimeoutError that IS an instanceof Error in every browser. jsdom's DOMException is not, which
 *  would make "instanceof Error ? e.message" look fine here while showing raw text to owners. */
const timeOut = (i: number) => act(async () => { sent[i].reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
const toasts: string[] = []
const onToast = (e: Event) => { toasts.push(String((e as CustomEvent<{ message: string }>).detail.message)) }

/** The parent as AlbumPageClient behaves: the patch is the next album. Exposed for the tests. */
let setAlbumFromOutside: (patch: Partial<Album>) => void = () => {}
/** Closing Settings: the toolbar unmounts the panel and keeps the album. */
let hidePanels: () => void = () => {}
let showPanels: () => void = () => {}
const options: Array<Record<string, unknown> | undefined> = []
function Harness({ open = 'media', slug = 'race' }: { open?: 'media' | 'slideshow'; slug?: string }) {
  const [album, setAlbum] = useState<Album>({ ...ALBUM, slug } as Album)
  const [shown, setShown] = useState(true)
  useEffect(() => {
    setAlbumFromOutside = (patch) => setAlbum((a) => ({ ...a, ...patch }))
    hidePanels = () => setShown(false)
    showPanels = () => setShown(true)
  }, [])
  return (
    <LocaleProvider locale="en" dict={en}>
      <div data-testid="album-radius">{album.media_radius}</div>
      <div data-testid="album-autoplay">{String(album.video_autoplay)}</div>
      <div data-testid="album-desktop">{String(album.desktop_grid_columns)}</div>
      {shown && <MediaSettingsPanels
        album={album}
        photos={[]}
        mediaRadiusMax={64}
        open={open}
        onToggle={() => {}}
        onAlbumUpdated={(patch, o) => { options.push(o); setAlbum((a) => ({ ...a, ...patch })) }}
      />}
    </LocaleProvider>
  )
}

const radiusSlider = () => document.querySelector('input[type="range"]') as HTMLInputElement
const autoplayBox = () => screen.getByLabelText(en['ot.videoAutoplay'], { exact: false }) as HTMLInputElement
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  sent.length = 0
  toasts.length = 0
  window.addEventListener(APP_TOAST_EVENT, onToast)
  options.length = 0
  vi.useFakeTimers()
  hold = false
  vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Promise<Response>((resolve, reject) => {
      const release = (a: Answer) => resolve(new Response(JSON.stringify(a.json), { status: a.status, headers: { 'Content-Type': 'application/json' } }))
      sent.push({ body, release, reject, signal: init?.signal })
      if (!hold) release(answer(body))
    })
  }))
})
afterEach(async () => {
  window.removeEventListener(APP_TOAST_EVENT, onToast)
  cleanup()
  vi.useRealTimers()
  // The per-album wire gate (lib/inflight-gate) is module scope and keyed by slug: a request a
  // hold-mode test left unanswered would hold the NEXT test's first request forever. Release
  // everything (a second release is a no-op), let any settle-sent request auto-answer, and drain.
  hold = false
  for (const s of sent) s.release(echo(s.body))
  await new Promise((r) => setTimeout(r, 0))
  vi.unstubAllGlobals()
})

describe('MediaSettingsPanels -- what goes on the wire', () => {
  it('THE TRACE: radius dragged, autoplay flipped inside the debounce window -- ONE request carrying BOTH', async () => {
    render(<Harness />)
    fireEvent.change(radiusSlider(), { target: { value: '40' } })
    expect(screen.getByTestId('album-radius').textContent).toBe('40')      // the grid redrew at once
    fireEvent.click(autoplayBox())
    await flush()
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toMatchObject({ slug: 'race', media_radius: 40, video_autoplay: true, reset_radius_overrides: true })
    // ...and the debounce that the drag scheduled does not fire a second, now-empty request.
    await act(async () => { vi.advanceTimersByTime(600) })
    await flush()
    expect(sent).toHaveLength(1)
  })

  it('a drag alone is one debounced write, after 500 ms, with the override reset', async () => {
    render(<Harness />)
    fireEvent.change(radiusSlider(), { target: { value: '20' } })
    fireEvent.change(radiusSlider(), { target: { value: '30' } })
    fireEvent.change(radiusSlider(), { target: { value: '40' } })
    expect(sent).toHaveLength(0)
    await act(async () => { vi.advanceTimersByTime(499) })
    expect(sent).toHaveLength(0)
    await act(async () => { vi.advanceTimersByTime(1) })
    await flush()
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toMatchObject({ media_radius: 40, reset_radius_overrides: true })
    expect(sent[0].body).not.toHaveProperty('video_autoplay')
    expect(sent[0].body).not.toHaveProperty('mobile_grid_columns')
  })

  it('a change from ELSEWHERE while Settings is open is shown, not overwritten by a stale copy', async () => {
    render(<Harness />)
    await act(async () => { setAlbumFromOutside({ mobile_grid_columns: 5 }) })
    // The owner then touches something unrelated. The phone grid must NOT go back to 3.
    fireEvent.click(autoplayBox())
    await flush()
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toMatchObject({ video_autoplay: true })
    expect(sent[0].body).not.toHaveProperty('mobile_grid_columns')
    // ...and the control reads the new truth.
    // The phone row and the desktop row both offer "5"; the phone row is the first grid after its label.
    const phoneRow = screen.getByText(en['ot.gridPhone']).nextElementSibling as HTMLElement
    const five = Array.from(phoneRow.querySelectorAll('button')).find((b) => b.textContent === '5') as HTMLElement
    expect(five.style.background).toContain('99, 8, 38')
  })

  it('a FAILED save puts the album back, so the grid does not keep showing a value the server refused', async () => {
    answer = () => ({ status: 500, json: { error: 'nope' } })
    try {
      render(<Harness />)
      fireEvent.click(autoplayBox())
      expect(screen.getByTestId('album-autoplay').textContent).toBe('true')   // optimistic
      await flush()
      expect(screen.getByTestId('album-autoplay').textContent).toBe('false')  // reverted
      expect(autoplayBox().checked).toBe(false)
      // And a second flip is a fresh attempt, not silently dropped as "unchanged".
      fireEvent.click(autoplayBox())
      await flush()
      expect(sent).toHaveLength(2)
      expect(sent[1].body).toMatchObject({ video_autoplay: true })
    } finally {
      answer = echo
    }
  })

  it('after a save lands, the same value is not sent again', async () => {
    render(<Harness />)
    fireEvent.click(autoplayBox())
    await flush()
    expect(sent).toHaveLength(1)
    // The successful save told the album; the echo comes back through the prop. Then an
    // unrelated edit must carry only itself.
    fireEvent.change(radiusSlider(), { target: { value: '24' } })
    await act(async () => { vi.advanceTimersByTime(500) })
    await flush()
    expect(sent).toHaveLength(2)
    expect(sent[1].body).toMatchObject({ media_radius: 24 })
    expect(sent[1].body).not.toHaveProperty('video_autoplay')
  })

  it('the server clamping what was sent is honoured: the slider shows the clamp and nothing re-sends', async () => {
    answer = () => ({ status: 200, json: { media_radius: 32 } })
    try {
      render(<Harness />)
      fireEvent.change(radiusSlider(), { target: { value: '40' } })
      await act(async () => { vi.advanceTimersByTime(500) })
      await flush()
      expect(radiusSlider().value).toBe('32')
      expect(screen.getByTestId('album-radius').textContent).toBe('32')
      await act(async () => { vi.advanceTimersByTime(1000) })
      await flush()
      expect(sent).toHaveLength(1)
    } finally {
      answer = echo
    }
  })

  it('closing Settings inside the debounce window FLUSHES the pending save rather than losing it', async () => {
    const { unmount } = render(<Harness />)
    fireEvent.change(radiusSlider(), { target: { value: '40' } })
    expect(sent).toHaveLength(0)
    unmount()
    await flush()
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toMatchObject({ media_radius: 40 })
  })

  it('a live radius drag tells the grid to draw the global value; the confirmed save does not', () => {
    render(<Harness />)
    fireEvent.change(radiusSlider(), { target: { value: '40' } })
    expect(options[0]).toMatchObject({ forceGlobalRadius: true })
  })

  it('a successful save tells the parent which per-photo overrides the server cleared', async () => {
    // The wire carried reset_radius_overrides and the server nulled every display_radius; if the
    // parent is not told, the grid keeps drawing overrides the server just deleted.
    render(<Harness />)
    fireEvent.change(radiusSlider(), { target: { value: '40' } })
    await act(async () => { vi.advanceTimersByTime(500) })
    await flush()
    expect(options).toContainEqual({ forceGlobalRadius: false, resetRadiusOverrides: true, resetFilterOverrides: false })
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'mono' } })
    await flush()
    expect(options).toContainEqual({ forceGlobalRadius: false, resetRadiusOverrides: false, resetFilterOverrides: true })
  })

  it('a FAILED desktop-columns save puts the album back where the server still is', async () => {
    answer = fail
    try {
      render(<Harness />)
      const desktopRow = screen.getByText(en['ot.gridDesktop']).nextElementSibling as HTMLElement
      const click = (n: string) => fireEvent.click(Array.from(desktopRow.querySelectorAll('button')).find((b) => b.textContent === n) as HTMLElement)
      click('4')
      expect(screen.getByTestId('album-desktop').textContent).toBe('4')      // optimistic
      await flush()
      expect(screen.getByTestId('album-desktop').textContent).toBe('6')      // back to the server's value
    } finally { answer = echo }
  })

  it('a desktop-columns failure does not write the old value over a newer click', async () => {
    hold = true
    render(<Harness />)
    const desktopRow = screen.getByText(en['ot.gridDesktop']).nextElementSibling as HTMLElement
    const click = (n: string) => fireEvent.click(Array.from(desktopRow.querySelectorAll('button')).find((b) => b.textContent === n) as HTMLElement)
    click('4')
    click('5')
    await flush()
    expect(sent).toHaveLength(1)                         // the desktop save waits for the album's wire too
    await resolveFail(0)                                 // 4 refused; 5 is the latest click, so no revert
    expect(screen.getByTestId('album-desktop').textContent).toBe('5')
    expect(sent).toHaveLength(2)
    await resolveOk(1)
    expect(screen.getByTestId('album-desktop').textContent).toBe('5')
  })

  it('a desktop value chosen AGAIN after an intervening click survives the first request failing late', async () => {
    // Comparing values could not tell "my click is still the latest" from "a later click chose
    // the same number": click 4, 5, 4 -- the first 4 fails -- and the owner's re-chosen 4 was reverted.
    hold = true
    render(<Harness />)
    const desktopRow = screen.getByText(en['ot.gridDesktop']).nextElementSibling as HTMLElement
    const click = (n: string) => fireEvent.click(Array.from(desktopRow.querySelectorAll('button')).find((b) => b.textContent === n) as HTMLElement)
    click('4'); click('5'); click('4')
    await flush()
    await resolveFail(0)
    expect(screen.getByTestId('album-desktop').textContent).toBe('4')
    await resolveOk(1); await resolveOk(2)
    expect(screen.getByTestId('album-desktop').textContent).toBe('4')
  })

  it('every settings write is bounded: the signal on the request is a timeout of MEDIA_SAVE_TIMEOUT_MS, created when the request LEAVES', async () => {
    // A signal that never fires satisfied "instanceof AbortSignal"; this pins the timeout itself.
    const spy = vi.spyOn(AbortSignal, 'timeout')
    try {
      hold = true
      render(<Harness />)
      fireEvent.click(autoplayBox())
      await flush()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith(MEDIA_SAVE_TIMEOUT_MS)
      expect(sent[0].signal).toBe(spy.mock.results[0].value)
      // A request queued behind it must not start its clock until it goes out.
      const desktopRow = screen.getByText(en['ot.gridDesktop']).nextElementSibling as HTMLElement
      fireEvent.click(Array.from(desktopRow.querySelectorAll('button')).find((b) => b.textContent === '4') as HTMLElement)
      await flush()
      expect(spy).toHaveBeenCalledTimes(1)
      await resolveOk(0)
      expect(spy).toHaveBeenCalledTimes(2)
      expect(sent[1].signal).toBe(spy.mock.results[1].value)
    } finally { spy.mockRestore() }
  })

  it('a timed-out media save: the translated network line, not the browser text, and the switch goes back', async () => {
    hold = true
    render(<Harness />)
    fireEvent.click(autoplayBox())
    await flush()
    await timeOut(0)
    expect(toasts).toEqual([en['common.networkError']])
    expect(autoplayBox().checked).toBe(false)
    expect(screen.getByTestId('album-autoplay').textContent).toBe('false')
  })

  it('a timed-out DESKTOP save is not silent: a toast, and the buttons go back', async () => {
    // It rejected past the caller's .then: no toast, no revert, an unhandled rejection in the panel.
    hold = true
    render(<Harness />)
    const desktopRow = screen.getByText(en['ot.gridDesktop']).nextElementSibling as HTMLElement
    fireEvent.click(Array.from(desktopRow.querySelectorAll('button')).find((b) => b.textContent === '4') as HTMLElement)
    await flush()
    await timeOut(0)
    expect(toasts).toEqual([en['common.networkError']])
    expect(screen.getByTestId('album-desktop').textContent).toBe('6')
  })

  it('a timed-out MOTION save is not silent either', async () => {
    hold = true
    render(<Harness open="slideshow" />)
    const slider = document.querySelectorAll('input[type="range"]')[1] as HTMLInputElement
    fireEvent.change(slider, { target: { value: '0' } })
    await act(async () => { vi.advanceTimersByTime(500) })
    await flush()
    expect(sent).toHaveLength(1)
    await timeOut(0)
    expect(toasts).toEqual([en['common.networkError']])
  })

  it("a failed desktop click after ANOTHER DEVICE changed the desktop grid reverts to that device's value", async () => {
    hold = true
    render(<Harness />)
    await act(async () => { setAlbumFromOutside({ desktop_grid_columns: 4 }) })     // broadcast refetch
    const desktopRow = screen.getByText(en['ot.gridDesktop']).nextElementSibling as HTMLElement
    fireEvent.click(Array.from(desktopRow.querySelectorAll('button')).find((b) => b.textContent === '5') as HTMLElement)
    await flush()
    await resolveFail(0)
    expect(screen.getByTestId('album-desktop').textContent).toBe('4')
  })

  it('after a desktop click has SETTLED, the baseline follows the album again (a later remote change, then a failure)', async () => {
    hold = true
    render(<Harness />)
    const desktopRow = screen.getByText(en['ot.gridDesktop']).nextElementSibling as HTMLElement
    const click = (n: string) => fireEvent.click(Array.from(desktopRow.querySelectorAll('button')).find((b) => b.textContent === n) as HTMLElement)
    click('4')
    await flush()
    await resolveOk(0)                                                              // settled: nothing out
    await act(async () => { setAlbumFromOutside({ desktop_grid_columns: 5 }) })    // another device
    click('3')
    await flush()
    await resolveFail(1)
    expect(screen.getByTestId('album-desktop').textContent).toBe('5')
  })

  it('after a desktop click has FAILED, the baseline still follows the album (a remote change, then another failure)', async () => {
    // A failed click counted back in only on success would freeze the baseline after one failure.
    hold = true
    render(<Harness />)
    const desktopRow = screen.getByText(en['ot.gridDesktop']).nextElementSibling as HTMLElement
    const click = (n: string) => fireEvent.click(Array.from(desktopRow.querySelectorAll('button')).find((b) => b.textContent === n) as HTMLElement)
    click('4')
    await flush()
    await resolveFail(0)
    await act(async () => { setAlbumFromOutside({ desktop_grid_columns: 5 }) })
    click('3')
    await flush()
    await resolveFail(1)
    expect(screen.getByTestId('album-desktop').textContent).toBe('5')
  })

  it('a failed desktop click after a phone-grid change reverts to the pin the route added, not to null', async () => {
    // The common album: no desktop choice. The phone-grid save pins the desktop and echoes it.
    answer = (body) => ({ ...echo(body), json: { ...echo(body).json, desktop_grid_columns: 3 } })
    try {
      render(<Harness />)
      await act(async () => { setAlbumFromOutside({ desktop_grid_columns: null }) })
      const phoneRow = screen.getByText(en['ot.gridPhone']).nextElementSibling as HTMLElement
      fireEvent.click(Array.from(phoneRow.querySelectorAll('button')).find((b) => b.textContent === '2') as HTMLElement)
      await flush()
      expect(screen.getByTestId('album-desktop').textContent).toBe('3')
      answer = fail
      const desktopRow = screen.getByText(en['ot.gridDesktop']).nextElementSibling as HTMLElement
      fireEvent.click(Array.from(desktopRow.querySelectorAll('button')).find((b) => b.textContent === '5') as HTMLElement)
      await flush()
      expect(screen.getByTestId('album-desktop').textContent).toBe('3')
    } finally { answer = echo }
  })

  it('OFFLINE (a TypeError from fetch) on each of the three paths: the translated network line', async () => {
    hold = true
    render(<Harness open="slideshow" />)
    // media path: the interval slider is the first range in the slideshow panel
    const ranges = document.querySelectorAll('input[type="range"]')
    fireEvent.change(ranges[0] as HTMLInputElement, { target: { value: '6000' } })
    await act(async () => { vi.advanceTimersByTime(500) })
    await flush()
    await act(async () => { sent[0].reject(new TypeError('Failed to fetch')); await flush() })
    expect(toasts).toEqual([en['common.networkError']])
    // motion path
    fireEvent.change(ranges[1] as HTMLInputElement, { target: { value: '0' } })
    await act(async () => { vi.advanceTimersByTime(500) })
    await flush()
    await act(async () => { sent[1].reject(new TypeError('Failed to fetch')); await flush() })
    expect(toasts).toEqual([en['common.networkError'], en['common.networkError']])
  })

  it('two desktop failures in a row revert to what the SERVER has, not to the first click', async () => {
    // Click 4 (fails), click 5 (fails): the revert used to read the album at the second click,
    // which already showed the first click's optimistic 4. The server never left 6.
    hold = true
    render(<Harness />)
    const desktopRow = screen.getByText(en['ot.gridDesktop']).nextElementSibling as HTMLElement
    const click = (n: string) => fireEvent.click(Array.from(desktopRow.querySelectorAll('button')).find((b) => b.textContent === n) as HTMLElement)
    click('4'); click('5')
    await flush()
    await resolveFail(0)
    await resolveFail(1)
    expect(screen.getByTestId('album-desktop').textContent).toBe('6')
    // ...and a success moves that baseline, so a later failure reverts to the new truth.
    click('3')
    await flush()
    await resolveOk(2)
    click('4')
    await flush()
    await resolveFail(3)
    expect(screen.getByTestId('album-desktop').textContent).toBe('3')
  })

  it('the wire is held PER ALBUM: another album\'s request leaves at once', async () => {
    hold = true
    const a = render(<Harness slug="race" />)
    const b = render(<Harness slug="other" />)
    fireEvent.click(within(a.container).getByLabelText(en['ot.videoAutoplay'], { exact: false }))
    await flush()
    expect(sent).toHaveLength(1)
    fireEvent.click(within(b.container).getByLabelText(en['ot.videoAutoplay'], { exact: false }))
    await flush()
    expect(sent).toHaveLength(2)
    expect(sent[1].body).toMatchObject({ slug: 'other', video_autoplay: true })
  })

  it('a phone-grid change on an album with no desktop choice: the album learns the desktop pin the route echoes', async () => {
    answer = (body) => ({ ...echo(body), json: { ...echo(body).json, desktop_grid_columns: 6 } })
    try {
      render(<Harness />)
      await act(async () => { setAlbumFromOutside({ desktop_grid_columns: null }) })
      const phoneRow = screen.getByText(en['ot.gridPhone']).nextElementSibling as HTMLElement
      fireEvent.click(Array.from(phoneRow.querySelectorAll('button')).find((b) => b.textContent === '2') as HTMLElement)
      await flush()
      expect(sent[0].body).toMatchObject({ mobile_grid_columns: 2 })
      expect(sent[0].body).not.toHaveProperty('desktop_grid_columns')
      expect(screen.getByTestId('album-desktop').textContent).toBe('6')
      // ...and the desktop buttons show the pin, not the number they were seeded with.
      const desktopRow = screen.getByText(en['ot.gridDesktop']).nextElementSibling as HTMLElement
      const six = Array.from(desktopRow.querySelectorAll('button')).find((b) => b.textContent === '6') as HTMLElement
      expect(six.style.background).toContain('99, 8, 38')
    } finally { answer = echo }
  })
})

describe('one request at a time -- the two sequences a review broke the first version with', () => {
  it('flip ON then OFF inside one round trip: the OFF goes out when the ON lands, and the grid never shows ON again', async () => {
    hold = true
    render(<Harness />)
    fireEvent.click(autoplayBox())
    await flush()
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toMatchObject({ video_autoplay: true })
    fireEvent.click(autoplayBox())
    await flush()
    expect(sent).toHaveLength(1)                       // nothing planned while one is out
    expect(autoplayBox().checked).toBe(false)
    expect(screen.getByTestId('album-autoplay').textContent).toBe('false')
    await resolveOk(0)
    expect(screen.getByTestId('album-autoplay').textContent).toBe('false')   // not told ON for one RTT
    expect(sent).toHaveLength(2)
    expect(sent[1].body).toMatchObject({ video_autoplay: false })
    await resolveOk(1)
    await act(async () => { vi.advanceTimersByTime(1000) })
    await flush()
    expect(sent).toHaveLength(2)
    expect(autoplayBox().checked).toBe(false)
  })

  it('the radius request fails after autoplay was flipped in flight: radius back to 16, the flip goes out alone, nothing stale later', async () => {
    hold = true
    render(<Harness />)
    fireEvent.change(radiusSlider(), { target: { value: '40' } })
    await act(async () => { vi.advanceTimersByTime(500) })
    await flush()
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toMatchObject({ media_radius: 40, reset_radius_overrides: true })
    fireEvent.click(autoplayBox())
    await flush()
    expect(sent).toHaveLength(1)
    await resolveFail(0)
    expect(screen.getByTestId('album-radius').textContent).toBe('16')
    expect(radiusSlider().value).toBe('16')
    expect(screen.getByTestId('album-autoplay').textContent).toBe('true')
    expect(sent).toHaveLength(2)
    expect(sent[1].body).toMatchObject({ video_autoplay: true, reset_radius_overrides: false })
    expect(sent[1].body).not.toHaveProperty('media_radius')
    await resolveOk(1)
    fireEvent.click(autoplayBox())
    await flush()
    expect(sent).toHaveLength(3)
    expect(sent[2].body).toMatchObject({ video_autoplay: false, reset_radius_overrides: false })
    expect(sent[2].body).not.toHaveProperty('media_radius')     // 16 is not quietly re-sent
  })

  it('slider 16 -> 40 -> 16 inside one round trip: the settle waits for the drag, then 16 is sent once with the reset', async () => {
    hold = true
    render(<Harness />)
    fireEvent.change(radiusSlider(), { target: { value: '40' } })
    await act(async () => { vi.advanceTimersByTime(500) })
    await flush()
    expect(sent).toHaveLength(1)
    fireEvent.change(radiusSlider(), { target: { value: '16' } })      // timer pending again
    await resolveOk(0)
    expect(sent).toHaveLength(1)                                        // the settle deferred to the drag
    expect(screen.getByTestId('album-radius').textContent).toBe('16')   // no jump to 40
    await act(async () => { vi.advanceTimersByTime(500) })
    await flush()
    expect(sent).toHaveLength(2)
    expect(sent[1].body).toMatchObject({ media_radius: 16, reset_radius_overrides: true })
    await resolveOk(1)
    await act(async () => { vi.advanceTimersByTime(1000) })
    await flush()
    expect(sent).toHaveLength(2)
  })

  it('close and REOPEN Settings inside one round trip: the reopened panel waits for the closed one\'s request', async () => {
    // Without the per-album gate the reopened panel sent at once; the database applied OFF then
    // ON, and when the slow ON answer landed the switch flipped itself back on.
    hold = true
    render(<Harness />)
    fireEvent.click(autoplayBox())
    await flush()
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toMatchObject({ video_autoplay: true })
    await act(async () => { hidePanels() })
    await act(async () => { showPanels() })
    expect(autoplayBox().checked).toBe(true)              // seeded from the optimistic album
    fireEvent.click(autoplayBox())
    await flush()
    expect(sent).toHaveLength(1)                          // OFF is planned, not yet on the wire
    expect(autoplayBox().checked).toBe(false)
    expect(screen.getByTestId('album-autoplay').textContent).toBe('false')
    await resolveOk(0)
    expect(sent).toHaveLength(2)                          // now it goes, after ON landed
    expect(sent[1].body).toMatchObject({ video_autoplay: false })
    expect(autoplayBox().checked).toBe(false)
    await resolveOk(1)
    expect(screen.getByTestId('album-autoplay').textContent).toBe('false')
    expect(autoplayBox().checked).toBe(false)
    await act(async () => { vi.advanceTimersByTime(1000) })
    await flush()
    expect(sent).toHaveLength(2)
  })

  it('close and reopen inside one round trip, and the first request FAILS: everything ends OFF', async () => {
    hold = true
    render(<Harness />)
    fireEvent.click(autoplayBox())
    await flush()
    await act(async () => { hidePanels() })
    await act(async () => { showPanels() })
    fireEvent.click(autoplayBox())
    await flush()
    expect(sent).toHaveLength(1)
    await resolveFail(0)
    expect(screen.getByTestId('album-autoplay').textContent).toBe('false')
    expect(sent).toHaveLength(2)
    expect(sent[1].body).toMatchObject({ video_autoplay: false })
    await resolveOk(1)
    expect(autoplayBox().checked).toBe(false)
    expect(screen.getByTestId('album-autoplay').textContent).toBe('false')
    await act(async () => { vi.advanceTimersByTime(1000) })
    await flush()
    expect(sent).toHaveLength(2)
  })

  it('closing Settings inside the motion debounce sends the motion the slideshow is already playing', async () => {
    render(<Harness open="slideshow" />)
    // The second range in the slideshow panel is the fade axis (the first is the interval, which
    // goes through the media save; distance is hidden while the move is 'none', as it is for this
    // album's 'fade' preset). Any axis would do: they share one timer. Fade starts at 100, so 0.
    const slider = document.querySelectorAll('input[type="range"]')[1] as HTMLInputElement
    fireEvent.change(slider, { target: { value: '0' } })
    expect(sent).toHaveLength(0)
    await act(async () => { hidePanels() })
    await flush()
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toHaveProperty('slideshow_motion')
    expect((sent[0].body.slideshow_motion as Record<string, unknown>).fade).toBe(0)
  })

  it('closing Settings while a save is in flight: the answer still reaches the album and the edit made in flight is sent', async () => {
    hold = true
    render(<Harness />)
    fireEvent.click(autoplayBox())
    await flush()
    fireEvent.change(radiusSlider(), { target: { value: '40' } })      // debounce pending
    await act(async () => { hidePanels() })
    expect(sent).toHaveLength(1)
    await resolveOk(0)
    expect(screen.getByTestId('album-autoplay').textContent).toBe('true')
    expect(sent).toHaveLength(2)
    expect(sent[1].body).toMatchObject({ media_radius: 40, reset_radius_overrides: true })
  })
})
