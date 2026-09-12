import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'

// THE RESET IS PROVEN IN lib/use-on-value-change. THIS PINS THE FOUR PLACES THAT ASK FOR IT.
//
// Each of these used to be an effect keyed on the photo, which commits the OLD state for one frame
// before the reset lands -- the previous photo's zoom cap, its encoding percentage, its poster
// aspect ratio, a card still mid-flip. The hook does it during render instead.
//
// What is pinned here is the KEY each call passes, because that is the part a reader cannot check
// against anything: two of these effects depended on more than the photo id, and a key that quietly
// drops one of those dependencies leaves a stale answer on screen for a row that changed underneath
// (a video whose stream_uid arrives once encoding starts), with every test still green.

const src = (...parts: string[]) => stripJsComments(readFileSync(join(process.cwd(), 'src', ...parts), 'utf8'))

const FILES: Array<[string, string[]]> = [
  ['useLightboxMedia', ['components', 'photo-grid', 'useLightboxMedia.ts']],
  ['LightboxOverlay', ['components', 'photo-grid', 'LightboxOverlay.tsx']],
  ['PhotoGrid', ['components', 'PhotoGrid.tsx']],
  ['PhotoSettingsModal', ['components', 'photo-grid', 'PhotoSettingsModal.tsx']],
]

describe('the four resets go through lib/use-on-value-change', () => {
  it('every one of them imports it, and none keeps a copy of the guard', () => {
    for (const [name, parts] of FILES) {
      const text = src(...parts)
      expect(text, name).toMatch(/import \{ useOnValueChange \} from '@\/lib\/use-on-value-change'/)
      expect(text, `${name} must not re-implement the guard`).not.toMatch(/Object\.is\(/)
    }
  })

  it('the lightbox media node and its measured cap reset on the photo', () => {
    const text = src('components', 'photo-grid', 'useLightboxMedia.ts')
    expect(text).toMatch(/useOnValueChange\(currentId, \(\) => \{\s+setLightboxMediaNode\(null\)\s+setLightboxRadiusMax\(null\)\s+\}\)/)
    // ...and no effect resets them any more, which is what left a frame of the old radius.
    expect(text).not.toMatch(/useEffect\(\(\) => \{\s+setLightboxMediaNode\(null\)/)
  })

  it("the video's encoding answer is cleared on everything the question depends on", () => {
    // id alone would leave the previous answer on a row whose stream_uid arrived later.
    const text = src('components', 'photo-grid', 'LightboxOverlay.tsx')
    expect(text).toMatch(/useOnValueChange\(`\$\{current\.id\}\|\$\{current\.media_type\}\|\$\{current\.stream_uid \?\? ''\}`, \(\) => setEncodingPct\(null\)\)/)
    expect(text, 'the fetch stays an effect; only the reset moved').toMatch(/React\.useEffect\(\(\) => \{\s+const uid = current\.stream_uid/)
    expect(text).not.toMatch(/React\.useEffect\(\(\) => \{\s+setEncodingPct\(null\)/)
  })

  it("the poster's aspect ratio is cleared on its own dependency list", () => {
    const text = src('components', 'photo-grid', 'LightboxOverlay.tsx')
    expect(text).toMatch(/useOnValueChange\(`\$\{current\.id\}\|\$\{current\.media_type\}\|\$\{current\.poster_url \?\? ''\}\|\$\{current\.stream_thumbnail_url \?\? ''\}\|\$\{hasStoredDims\}`, \(\) => setVideoAspect\(null\)\)/)
    expect(text).not.toMatch(/React\.useEffect\(\(\) => \{\s+setVideoAspect\(null\)/)
  })

  it('a flipped card is dropped when the shown photo changes', () => {
    const text = src('components', 'PhotoGrid.tsx')
    expect(text).toMatch(/useOnValueChange\(current\?\.id, \(\) => setFlippedPhotoId\(null\)\)/)
    expect(text).not.toMatch(/useEffect\(\(\) => \{\s+setFlippedPhotoId\(null\)/)
  })

  it('the radius box resyncs when the value changes AND when typing stops', () => {
    // radiusEditing is in the KEY, not just the condition: the old effect listed it as a dependency,
    // so letting go of the box put the real value back. A key of `radius` alone loses that.
    const text = src('components', 'photo-grid', 'PhotoSettingsModal.tsx')
    expect(text).toMatch(/useOnValueChange\(`\$\{radius\}\|\$\{radiusEditing\}`, \(\) => \{ if \(!radiusEditing\) setRadiusDraft\(String\(radius\)\) \}\)/)
    expect(text).not.toMatch(/useEffect\(\(\) => \{\s+if \(!radiusEditing\)/)
  })
})
