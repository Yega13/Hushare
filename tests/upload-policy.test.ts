import { describe, it, expect } from 'vitest'
import {
  MAX_IMG_DIM, SHRINK_LADDER, needsReEncode, outputMimeFor, nextShrinkDim,
  backoffDelay, isNetworkClass, isExpectedRefusal, EXPECTED_REFUSAL_PREFIXES,
} from '@/lib/upload-policy'

// THE UPLOADER'S JUDGEMENTS ABOUT SOMEONE ELSE'S PHOTO.
//
// UploadZone.tsx is 2,846 lines and had no test of any kind. These are the decisions inside it that
// a customer would notice if they were wrong — and every one of them fails SILENTLY: a photo comes
// back softer than it went in, a failed upload is dropped instead of retried, a transparent logo
// arrives with a black background. Nothing throws. Nobody reports it. You find out from a customer,
// months later, if at all.

const MB = 1024 * 1024

describe('a photo is kept exactly as shot unless keeping it would refuse it', () => {
  const CAP = 25 * MB

  it('does not touch a photo inside both limits', () => {
    // The whole point of the change from `file.size > 1.2MB`. Under that rule every phone photo was
    // re-encoded and the original thrown away — including images already smaller than the target.
    expect(needsReEncode(3000, 8 * MB, CAP)).toBe(false)
    expect(needsReEncode(MAX_IMG_DIM, 8 * MB, CAP)).toBe(false)
  })

  it('re-encodes a photo longer than the stored edge', () => {
    expect(needsReEncode(MAX_IMG_DIM + 1, 1 * MB, CAP)).toBe(true)
  })

  it('re-encodes a photo the album would otherwise refuse', () => {
    // Smaller than the edge limit but over the cap: shrinking is the only alternative to refusing.
    expect(needsReEncode(2000, CAP + 1, CAP)).toBe(true)
  })

  it('holds at the boundary in both directions', () => {
    // Off-by-one here means every photo at exactly the limit is needlessly re-encoded.
    expect(needsReEncode(MAX_IMG_DIM, CAP, CAP)).toBe(false)
    expect(needsReEncode(MAX_IMG_DIM + 1, CAP, CAP)).toBe(true)
    expect(needsReEncode(MAX_IMG_DIM, CAP + 1, CAP)).toBe(true)
  })

  it('keeps a full-page print at full quality', () => {
    // A4 at 300dpi is 3508px, which is why the limit is what it is. A 3500px photo must survive
    // untouched or printing an album is visibly worse than the shot that went in.
    expect(MAX_IMG_DIM).toBeGreaterThanOrEqual(3500)
  })
})

describe('a re-encode never destroys transparency', () => {
  it('keeps PNG as PNG and WebP as WebP', () => {
    // A JPEG re-encode turned every transparent area solid black. On a logo or a cut-out that is
    // not a quality regression, it is a ruined image.
    expect(outputMimeFor('image/png')).toBe('image/png')
    expect(outputMimeFor('image/webp')).toBe('image/webp')
  })

  it('sends everything else to JPEG', () => {
    // AVIF is deliberately NOT in this list. It carries transparency and would lose it here, and
    // enshrining that as correct is how a real bug gets a test defending it. It is unreachable
    // today only because the server refuses to store AVIF at all.
    for (const m of ['image/jpeg', 'image/jpg', 'image/heic', 'image/gif', 'image/tiff', '']) {
      expect(outputMimeFor(m), `${m} should encode as JPEG`).toBe('image/jpeg')
    }
  })

  it('is not fooled by capital letters', () => {
    // A caller handing over a raw file.type gets "image/PNG" on some platforms. Matching
    // case-sensitively would send it to JPEG and turn every transparent area solid black.
    expect(outputMimeFor('image/PNG')).toBe('image/png')
    expect(outputMimeFor('IMAGE/WEBP')).toBe('image/webp')
  })
})

describe('the shrink ladder comes down no further than it must', () => {
  const CAP = 10 * MB

  it('stops immediately when the first encode already fits', () => {
    // A photo 10% over the edge limit must lose nothing beyond the 3500px pass.
    expect(nextShrinkDim(0, CAP - 1, CAP)).toBeNull()
    // EXACTLY on the cap counts as fitting. Without this line, changing `<=` to `<` passes the
    // whole suite and every photo that lands precisely on the cap is shrunk a rung for nothing —
    // found by mutating the module, not by reading it.
    expect(nextShrinkDim(0, CAP, CAP)).toBeNull()
  })

  it('takes one rung at a time while it does not fit', () => {
    expect(nextShrinkDim(0, CAP + 1, CAP)).toBe(SHRINK_LADDER[1])
    expect(nextShrinkDim(1, CAP + 1, CAP)).toBe(SHRINK_LADDER[2])
  })

  it('accepts the last rung whatever its size, rather than refusing the upload', () => {
    // A smaller photo beats a photo the guest was not allowed to send.
    expect(nextShrinkDim(SHRINK_LADDER.length - 1, CAP * 100, CAP)).toBeNull()
  })

  it('only ever goes down', () => {
    for (let i = 1; i < SHRINK_LADDER.length; i++) {
      expect(SHRINK_LADDER[i], 'a rung that grows would re-encode upward and lose quality for nothing')
        .toBeLessThan(SHRINK_LADDER[i - 1])
    }
    expect(SHRINK_LADDER[0]).toBe(MAX_IMG_DIM)
  })
})

describe('retry pacing survives a room full of phones', () => {
  // backoffDelay returns the COMPLETE wait. It used to return a base that all three call sites
  // multiplied by a second random factor themselves, so the numbers asserted here described a curve
  // the product never used — and the larger half of the herd guard was outside any test.
  const floor = (attempt: number) => backoffDelay(attempt, () => 0)   // both draws minimal
  const ceil = (attempt: number) => backoffDelay(attempt, () => 1)    // both draws maximal

  it('backs off exponentially', () => {
    // At the floor the wait is half the exponential step, because the second jitter bottoms at 0.5.
    expect(floor(1)).toBe(250)
    expect(floor(2)).toBe(500)
    expect(floor(3)).toBe(1000)
    expect(floor(4)).toBe(2000)
  })

  it('stops growing, so a long outage does not become an hour-long wait', () => {
    expect(floor(10)).toBe(4000)
    expect(floor(50)).toBe(4000)
    expect(ceil(50)).toBe(8300)
  })

  it('ALWAYS adds jitter, on the path production actually takes', () => {
    // THE TEST THAT COULD NOT SEE ITS OWN SUBJECT. The previous version passed `() => 0` and
    // `() => 1` explicitly, which proves the parameter is wired up and says nothing about whether
    // the default draws randomly. Replacing the default with `() => 0` left the whole suite green —
    // meaning every phone in a room would have waited an identical 250ms and retried in lockstep,
    // which is the exact failure the test is named after.
    //
    // So: call it the way production does, with no argument, and demand the waits differ.
    const samples = new Set(Array.from({ length: 200 }, () => backoffDelay(1)))
    expect(samples.size, 'the default path must be random, or 300 phones retry in lockstep').toBeGreaterThan(50)
  })

  it('the jitter is wide enough to actually spread a room out', () => {
    // Distinct values are not enough — they could all sit within a millisecond of each other. The
    // spread has to be a meaningful fraction of the wait itself.
    const samples = Array.from({ length: 500 }, () => backoffDelay(1))
    const spread = Math.max(...samples) - Math.min(...samples)
    expect(spread, 'attempt 1 should scatter across hundreds of ms').toBeGreaterThan(200)
  })

  it('never waits a negative or absurd amount', () => {
    for (let attempt = 1; attempt <= 20; attempt++) {
      const d = backoffDelay(attempt)
      expect(d).toBeGreaterThan(0)
      expect(d).toBeLessThanOrEqual(8300)
    }
  })
})

describe('a failed upload is retried only when retrying could help', () => {
  it('treats a dead connection as network-class', () => {
    // fetch() rejects with TypeError for DNS, TCP, TLS and resets — no response ever arrived.
    expect(isNetworkClass(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkClass(new DOMException('timed out', 'TimeoutError'))).toBe(true)
  })

  it('does NOT treat a server answer as network-class, even a 500', () => {
    // The server was reached and replied. Waiting for the network to come back cannot help, and
    // parking the upload would leave a guest's photo pending for a problem that is not theirs.
    expect(isNetworkClass(new Error('HTTP 500'))).toBe(false)
    expect(isNetworkClass(new DOMException('aborted', 'AbortError'))).toBe(false)
    expect(isNetworkClass(null)).toBe(false)
    expect(isNetworkClass('Failed to fetch')).toBe(false)
  })
})

describe('a refusal the product made on purpose is not an error', () => {
  it('recognises each thing the product deliberately refuses', () => {
    for (const prefix of EXPECTED_REFUSAL_PREFIXES) {
      expect(isExpectedRefusal(prefix), `${prefix} is a decision, not a fault`).toBe(true)
      expect(isExpectedRefusal(`${prefix} — 40MB, cap is 25MB`), 'prefix match, with detail after').toBe(true)
    }
  })

  it('does not swallow a real failure that merely mentions one', () => {
    // Prefix, not substring: a genuine crash whose text happens to contain "Unsupported" must still
    // reach the error panel.
    expect(isExpectedRefusal('Upload crashed: Unsupported operation')).toBe(false)
    expect(isExpectedRefusal('Network error during upload')).toBe(false)
    expect(isExpectedRefusal('')).toBe(false)
  })
})
