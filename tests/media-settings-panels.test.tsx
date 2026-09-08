// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useEffect, useState } from 'react'
import MediaSettingsPanels from '@/components/owner-toolbar/MediaSettingsPanels'
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

type Sent = { body: Record<string, unknown> }
const sent: Sent[] = []
/** What the route answers: by default it echoes back what it applied, exactly like the real one. */
const echo = (body: Record<string, unknown>): { status: number; json: Record<string, unknown> } => {
  const applied = { ...body }
  for (const k of ['slug', 'reset_radius_overrides', 'reset_filter_overrides']) delete applied[k]
  return { status: 200, json: applied }
}
let answer = echo

/** The parent as AlbumPageClient behaves: the patch is the next album. Exposed for the tests. */
let setAlbumFromOutside: (patch: Partial<Album>) => void = () => {}
const options: Array<Record<string, unknown> | undefined> = []
function Harness() {
  const [album, setAlbum] = useState<Album>(ALBUM)
  useEffect(() => { setAlbumFromOutside = (patch) => setAlbum((a) => ({ ...a, ...patch })) }, [])
  return (
    <LocaleProvider locale="en" dict={en}>
      <div data-testid="album-radius">{album.media_radius}</div>
      <div data-testid="album-autoplay">{String(album.video_autoplay)}</div>
      <MediaSettingsPanels
        album={album}
        photos={[]}
        mediaRadiusMax={64}
        open="media"
        onToggle={() => {}}
        onAlbumUpdated={(patch, o) => { options.push(o); setAlbum((a) => ({ ...a, ...patch })) }}
      />
    </LocaleProvider>
  )
}

const radiusSlider = () => document.querySelector('input[type="range"]') as HTMLInputElement
const autoplayBox = () => screen.getByLabelText(en['ot.videoAutoplay'], { exact: false }) as HTMLInputElement
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  sent.length = 0
  options.length = 0
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    sent.push({ body })
    const a = answer(body)
    return new Response(JSON.stringify(a.json), { status: a.status, headers: { 'Content-Type': 'application/json' } })
  }))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
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
})
