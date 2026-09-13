import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'

// THE PIPELINE IS PROVEN IN tests/image-pipeline.test.ts. THIS PINS WHAT UploadZone HANDS IT.
//
// Every dependency below has a plausible wrong version that type-checks and passes every other test.
// The review of ccb9b1d swapped five of them and the whole suite stayed green:
//   - an unbounded decode slot: a phone decoding a batch of 48 MP photos at once runs out of memory;
//   - a bare arrayBuffer() for the retrying read: iPhone photos with a stale file reference fail;
//   - decodeBitmapSafe passed as decodeImageSource: Android Chrome loses its HEIC decoder;
//   - a low-quality resample: every shrunk photo comes out softer;
//   - an object URL never revoked: every unreadable photo leaks its whole file.
// So the block is pinned whole. Changing one line fails here, and whoever changes it says why here.

const NEWLINE = String.fromCharCode(10)
const src = () =>
  stripJsComments(readFileSync(join(process.cwd(), 'src', 'components', 'UploadZone.tsx'), 'utf8'))
    .split(String.fromCharCode(13)).join('')

describe('UploadZone hands the photo pipeline the real browser', () => {
  it('passes exactly these dependencies, and nothing that merely type-checks', () => {
    const text = src()
    const start = text.indexOf('const { processImage } = createImagePipeline({')
    expect(start, 'the pipeline must be built here').toBeGreaterThan(-1)
    const end = text.indexOf(NEWLINE + '})', start)
    const block = text.slice(start, end + 3).split(NEWLINE).map((l) => l.trim())
    expect(block).toEqual([
      'const { processImage } = createImagePipeline({',
      'bitmapToBlob,',
      "resizeBitmap: (bitmap, w, h) => createImageBitmap(bitmap, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }),",
      'decodeImageSource,',
      'decodeBitmapSafe,',
      'convertHeicViaWorker,',
      'convertHeicMainThread,',
      'readBytes: (blob) => readFileRobust(blob),',
      'createObjectURL: (blob) => URL.createObjectURL(blob),',
      'revokeObjectURL: (url) => URL.revokeObjectURL(url),',
      'loadImageElement,',
      'acquireDecode: () => decodeSem.acquire(),',
      '})',
    ])
    expect(text.split('createImagePipeline(').length - 1, 'built once, not per upload').toBe(1)
  })

  it('the names it passes are the real ones', () => {
    const text = src()
    expect(text).toMatch(/import \{[^}]*\bdecodeBitmapSafe\b[^}]*\bdecodeImageSource\b[^}]*\} from '@\/lib\/image-decode'/)
    expect(text).toMatch(/import \{[^}]*\breadFileRobust\b[^}]*\} from '@\/lib\/file-read'/)
    expect(text).toMatch(/import \{ createImagePipeline \} from '@\/lib\/upload\/image-pipeline'/)
    expect(text).toMatch(/const \{ bitmapToBlob \} = createImageEncoder\(\{/)
  })

  it('decodes stay bounded: 2 at a time on a phone, 4 elsewhere', () => {
    expect(src()).toMatch(/const decodeSem = new Semaphore\(\s*typeof navigator !== 'undefined' && \/Mobi\|Android\/i\.test\(navigator\.userAgent\) \? 2 : 4,\s*\)/)
  })

  it('the <img> loader settles both ways, so an undisplayable file cannot hold its decode slot forever', () => {
    const text = src()
    expect(text).toMatch(/img\.onload = \(\) => resolve\(img\)/)
    expect(text).toMatch(/img\.onerror = \(\) => reject\(new Error\('img element load failed'\)\)/)
  })

  it('the HEIC converters are given the real worker script, the retrying read and the real heic2any', () => {
    const text = src()
    expect(text).toMatch(/import \{ convertHeicWith, createHeicWorkerClient \} from '@\/lib\/upload\/heic-convert'/)
    expect(text).toContain('const { convert: convertHeicViaWorker } = createHeicWorkerClient({')
    // Literal, because the bundler only finds the worker file by reading this expression as written.
    expect(text).toContain("createWorker: () => new Worker(new URL('../lib/heic-worker.ts', import.meta.url), { type: 'module' }),")
    expect(text).toContain('readBytes: (file) => readFileRobust(file),')
    expect(text).toContain("return convertHeicWith(() => import('heic2any'), file)")
    // The bookkeeping left with the module; none of it may grow back here.
    expect(text).not.toMatch(/_heicCallbacks|_heicWorker|function getHeicWorker/)
  })
})
