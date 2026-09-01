import { describe, it, expect } from 'vitest'
import {
  MAX_IMG_DIM, SHRINK_LADDER, needsReEncode, outputMimeFor, nextShrinkDim,
  maxImageDimFor, shrinkLadderFor, OWNER_IMG_DIM,
  backoffDelay, isNetworkClass, isExpectedRefusal, EXPECTED_REFUSAL_PREFIXES,
  createRelayPolicy, verdictForResponse, verdictForThrow,
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

// WHICH ROUTE DO THE BYTES TAKE — and the incident behind it.
//
// A photo normally goes straight to R2. Some networks block R2's upload domain, so there is a
// fallback that streams the body through our own Worker. Choosing wrong is expensive: on
// 2026-08-17 that fallback is what Cloudflare killed 328 requests for exceeding resources — 100% of
// that day's Worker errors — because a single connectivity blip latched the flag on and every
// remaining photo in the session took the slow path.
//
// The rule that prevents it is subtle enough to be worth pinning: a direct failure PROVES NOTHING,
// because losing connectivity looks exactly like a blocked domain. Only a relay that SUCCEEDED
// where the direct path failed is evidence. And the belief expires, because phones move between
// wifi and cellular mid-event.
describe('the expensive upload path is only taken on proof', () => {
  const at = (t: number) => () => t

  it('tries the direct path first, always, until something is proven', () => {
    const p = createRelayPolicy(at(1000))
    expect(p.shouldRelayFirst()).toBe(false)
    expect(p.isRelayBelieved()).toBe(false)
  })

  it('believes a block only after the relay SUCCEEDED where direct failed', () => {
    const p = createRelayPolicy(at(1000))
    p.recordRelaySucceededAfterDirectFailure()
    expect(p.shouldRelayFirst()).toBe(true)
  })

  it('stops believing once the probe window passes', () => {
    // A phone that moved from a blocking network to a working one must not keep paying for the
    // Worker path for the rest of the session.
    let clock = 1000
    const p = createRelayPolicy(() => clock, 60_000)
    p.recordRelaySucceededAfterDirectFailure()
    clock += 59_999
    expect(p.shouldRelayFirst(), 'still inside the window').toBe(true)
    clock += 2
    expect(p.shouldRelayFirst(), 'window passed — try direct again').toBe(false)
    expect(p.isRelayBelieved(), 'and the belief is actually cleared, not just skipped').toBe(false)
  })

  it('re-arms if the block is proven again after expiry', () => {
    let clock = 1000
    const p = createRelayPolicy(() => clock, 60_000)
    p.recordRelaySucceededAfterDirectFailure()
    clock += 100_000
    expect(p.shouldRelayFirst()).toBe(false)
    p.recordRelaySucceededAfterDirectFailure()
    expect(p.shouldRelayFirst(), 'a network that still blocks re-proves it').toBe(true)
  })

  it('keeps two independent policies apart', () => {
    // Stream's upload domain and R2's are different hosts. One being blocked says nothing about the
    // other, and sharing a flag would send video through a relay on an R2 block alone.
    const images = createRelayPolicy(at(1000))
    const video = createRelayPolicy(at(1000))
    images.recordRelaySucceededAfterDirectFailure()
    expect(images.shouldRelayFirst()).toBe(true)
    expect(video.shouldRelayFirst(), 'a block on one host must not implicate the other').toBe(false)
  })
})

describe('is this failure worth another attempt', () => {
  const base = { serverErrorsSoFar: 0, maxServerErrors: 4, withinDeadline: true }

  it('never retries a deterministic 4xx — the answer will not change', () => {
    // Too large, album locked, type refused. Retrying burns the deadline to arrive at the same
    // refusal, and the guest waits for nothing. 429 is NOT in this list — it is a "slow down"
    // signal, not a verdict, and is covered separately below.
    for (const status of [400, 401, 403, 404, 413, 415, 422]) {
      expect(verdictForResponse({ ...base, status }), `${status} must not retry`).toBe('accept')
    }
  })

  it('RETRIES a 429 — it is a slow-down signal, not a refusal', () => {
    // The photo-losing bug: at an event the rate-limit ceiling cannot be reached legitimately
    // (5,000 uploads against a 12,000/hour limit), so a 429 from presign is always a blip in the
    // Supabase-backed limiter. Treating it as final turned that blip into a photo the guest had to
    // notice was missing and manually re-add. Retried with backoff, it is a two-second delay.
    expect(verdictForResponse({ ...base, status: 429 })).toBe('retry')
  })

  it('stops retrying a 429 once the budget or deadline is spent', () => {
    // Bounded exactly like a 5xx: a genuine sustained rate limit must not be hammered forever.
    expect(verdictForResponse({ ...base, status: 429, serverErrorsSoFar: 3, maxServerErrors: 4 })).toBe('accept')
    expect(verdictForResponse({ ...base, status: 429, withinDeadline: false })).toBe('accept')
  })

  it('retries a 5xx while there is budget and time', () => {
    expect(verdictForResponse({ ...base, status: 500 })).toBe('retry')
    expect(verdictForResponse({ ...base, status: 503 })).toBe('retry')
  })

  it('returns the 5xx rather than retrying forever', () => {
    // Accept, not give-up: the caller returns the RESPONSE, so the failure surfaces with its real
    // status instead of as a generic network error nobody can diagnose.
    expect(verdictForResponse({ ...base, status: 500, serverErrorsSoFar: 3, maxServerErrors: 4 })).toBe('accept')
    expect(verdictForResponse({ ...base, status: 500, withinDeadline: false })).toBe('accept')
  })

  it('treats a deliberate cancel as final, never as transient', () => {
    // Without this, an abort surfaces as a plain DOMException, the network check says "not
    // network", and the loop politely retries the exact request the user just cancelled.
    expect(verdictForThrow({ aborted: true, withinDeadline: true })).toBe('give-up')
  })

  it('retries a dead connection while time remains, and stops when it does not', () => {
    expect(verdictForThrow({ aborted: false, withinDeadline: true })).toBe('retry')
    expect(verdictForThrow({ aborted: false, withinDeadline: false })).toBe('give-up')
  })
})


describe('whose upload keeps how many pixels', () => {
  // 3500px was right for guests (fast on venue WiFi, bigger than a phone photo) and silently
  // halved the detail of the first professional photographer's entire event — 4,566 photos, every
  // original larger, every stored copy exactly 3500px, discovered from their runners' downloads.
  // The owner is not on venue WiFi and the pictures are their work.

  it('the owner keeps full camera quality; a guest keeps the fast upload', () => {
    expect(maxImageDimFor(true)).toBe(OWNER_IMG_DIM)
    expect(maxImageDimFor(false)).toBe(MAX_IMG_DIM)
  })

  it('the owner cap actually covers a 24MP full-frame camera', () => {
    // 6000x4000 is the standard 24MP frame. If OWNER_IMG_DIM ever dips below its long edge, the
    // exact photos this exists for get shrunk again and nobody is told.
    expect(OWNER_IMG_DIM).toBeGreaterThanOrEqual(6000)
    expect(OWNER_IMG_DIM, 'above ~8K the lightbox download stops being viewable on a phone plan')
      .toBeLessThanOrEqual(8000)
  })

  it('the ladder starts at the cap that was asked for — callers index rung 0', () => {
    expect(shrinkLadderFor(MAX_IMG_DIM)[0]).toBe(MAX_IMG_DIM)
    expect(shrinkLadderFor(OWNER_IMG_DIM)[0]).toBe(OWNER_IMG_DIM)
  })

  it("the owner's ladder still descends to sizes that fit any album's byte cap", () => {
    // An owner photo too big in BYTES at 6000px must be able to come down the same rungs a guest
    // photo does — otherwise the last-rung guarantee ("a refused upload is worse than a smaller
    // photo") silently stops holding for exactly the largest files.
    const ladder = shrinkLadderFor(OWNER_IMG_DIM)
    expect(ladder).toEqual([OWNER_IMG_DIM, ...SHRINK_LADDER])
  })

  it('the guest cap yields exactly the guest ladder', () => {
    expect(shrinkLadderFor(MAX_IMG_DIM)).toEqual(SHRINK_LADDER)
  })

  it('a cap BELOW the ladder never climbs back above itself', () => {
    // The invariant is ladder[0] === the cap asked for — for every cap, not just today's two.
    // An early version returned the guest ladder here, so a hypothetical 1920 cap would have
    // encoded its first attempt at 3500: above its own cap, silently.
    expect(shrinkLadderFor(1920)).toEqual([1920])
    expect(shrinkLadderFor(3000)).toEqual([3000, 2560, 1920])
  })
})
