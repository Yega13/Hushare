import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'

// THE MODULES ARE PROVEN. THIS PINS THE LINES IN UploadZone THAT DECIDE WHETHER THEY RUN.
// Same rule as album-page-wiring: names are pinned, because every wrong name is "derived".

const SOURCE = join(process.cwd(), 'src', 'components', 'UploadZone.tsx')
const src = () => stripJsComments(readFileSync(SOURCE, 'utf8'))

describe('UploadZone classifies failures through lib/upload/failure and defines none of its own', () => {
  it('imports the classifiers and the error class from the module', () => {
    const text = src()
    for (const name of ['VideoUploadError', 'friendlyUploadError', 'isDeterministicTusError', 'isRecoverableNetworkFailure', 'tusHttpStatus']) {
      expect(text, name).toMatch(new RegExp(String.raw`import \{[^}]*\b` + name + String.raw`\b[^}]*\} from '@/lib/upload/failure'`, 's'))
    }
  })
  it('keeps no local definition of any of them (a second copy is where they drift apart)', () => {
    const text = src()
    expect(text).not.toMatch(/class VideoUploadError|function friendlyUploadError|function isDeterministicTusError|function isRecoverableNetworkFailure|function tusHttpStatus|function errText/)
    expect(text).not.toMatch(/failed to fetch\|/)
  })
  it('the park decision is the module\'s verdict on the real error, with nothing hard-wired', () => {
    // The one-resume rule is the module's now: shouldPark decides, and it is handed the real
    // error's verdict and the real entry -- never a literal.
    expect(src()).toMatch(/const parked = shouldPark\(isRecoverableNetworkFailure\(e\), entry\)/)
  })
})

describe('UploadZone retries through lib/upload/retry-plan, and never re-uploads what is already in R2', () => {
  it('BOTH Retry paths re-save a file whose row is queued, instead of sending its bytes again', () => {
    const text = src()
    // The tile.
    expect(text).toMatch(/if \(retryMode\(id, new Set\(pendingSaveRef\.current\.map\(p => p\.entryId\)\)\) === 'resave'\) \{\s+void retryBlockedRows\(\)\s+return\s+\}/)
    // The failed chip.
    expect(text).toMatch(/if \(failed\.some\(e => retryMode\(e\.id, pendingIds\) === 'resave'\)\) void retryBlockedRows\(\)/)
    expect(text).toMatch(/\.filter\(e => retryMode\(e\.id, pendingIds\) === 'reupload'\)/)
    // The ids come from the REAL queue: an empty set passes every text match above while the
    // chip re-uploads every queued file -- the original bug, verbatim.
    expect(text).toMatch(/const pendingIds = new Set\(pendingSaveRef\.current\.map\(p => p\.entryId\)\)/)
    // ...and the re-save runs BEFORE the re-upload guard and before the early return. When every
    // failure is a refused save there is nothing to re-upload, and a chip that returned first
    // would be a dead button for exactly the case this fixes.
    const chip = text.slice(text.indexOf('const retryFailedUploads'))
    const resaveAt = chip.indexOf('if (failed.some(e => retryMode(e.id, pendingIds)')
    expect(resaveAt).toBeGreaterThan(-1)
    expect(chip.indexOf('if (retryingRef.current) return'), 'the guard sits after the re-save').toBeGreaterThan(resaveAt)
    expect(chip.indexOf('if (fresh.length === 0) return'), 'the early return sits after the re-save').toBeGreaterThan(resaveAt)
  })
  it('each retry trigger names itself, so the one automatic resume is spent or earned correctly', () => {
    const text = src()
    expect(text).toMatch(/freshEntryFor\(entry, 'tap'\)/)
    expect(text).toMatch(/freshEntryFor\(e, 'chip'\)/)
    expect(text).toMatch(/freshEntryFor\(e, 'auto'\)/)
    // ...and no path builds a fresh entry by hand any more.
    expect(text).not.toMatch(/autoResumed: (true|false)/)
  })
  it('the pending-save queue is keyed, and the banner reducer is the module\'s', () => {
    const text = src()
    expect(text).toMatch(/pendingSaveRef\.current = queuePendingRows\(pendingSaveRef\.current, pairs\)/)
    expect(text).toMatch(/setPendingSaveReason\(prev => mergeWall\(prev, wallFor\(code, nudge\)\)\)/)
  })
})

describe('UploadZone writes its rows through lib/upload/row-saver and keeps no copy of the rules', () => {
  it('the saver is built with the real save call and the real album, and defines no batching here', () => {
    const text = src()
    expect(text).toMatch(/createRowSaver<PhotoRow>\(\{/)
    expect(text).toMatch(/save: \(rows\) => saveUploadedRows\(album\.id, rows\)/)
    // The debounce, the serial chain, the refused-uid rule and the warn-once left with it.
    expect(text).not.toMatch(/SAVE_DEBOUNCE_MS|let chain: Promise|function createRowSaver|warned = true/)
  })
  it('each answer reaches the screen: saved ticks green, failed keeps its code and rows, warning toasts', () => {
    const text = src()
    expect(text).toMatch(/onSaved: \(ids\) => \{ for \(const id of ids\) patchEntry\(id, \{ status: 'done', progress: 100 \}\) \}/)
    expect(text).toMatch(/onFailed: \(ids, msg, code, rows, nudge\) => \{/)
    expect(text).toMatch(/onWarning: \(msg\) => showAppToast\(msg, 'success'\)/)
  })
})

describe('UploadZone files a refusal as a refusal, and only a fault as an error', () => {
  // The classifiers are proven in their own modules; these pin the lines that decide whether they
  // are asked, and of what. On 2026-09-07 and 2026-09-08 presign refused two full albums, and the
  // refusal reached the report with no code -- so it could only ever be filed as an upload fault.
  it('both refusals are read by the one reader, so presign and save carry the same code', () => {
    const text = src()
    expect(text).toMatch(/import \{[^}]*\brefusalFrom\b[^}]*\} from '@\/lib\/upload\/failure'/)
    expect(text).toMatch(/if \(!presignRes\.ok\) throw await refusalFrom\(presignRes, 'Presign failed'\)/)
    expect(text).toMatch(/if \(!res\.ok\) throw await refusalFrom\(res, 'Save failed'\)/)
    // ...and neither reads a refusal by hand any more.
    expect(text).not.toMatch(/const err = await presignRes\.json\(\)/)
    expect(text).not.toMatch(/Save failed \(\$\{res\.status\}\)/)
  })
  it('the batch report carries the code and files a full album as the refusal it is', () => {
    const text = src()
    expect(text).toMatch(/code: typeof \(e as \{ code\?: unknown \}\)\?\.code === 'string' \? \(e as \{ code: string \}\)\.code : undefined/)
    expect(text).toMatch(/const full = sample\.code === 'album_full'/)
    expect(text).toMatch(/const expected = full \|\| isExpectedRefusal\(sample\.msg\)/)
    expect(text).toMatch(/const level = expected \|\| sample\.parked \? 'warn' : 'error'/)
    expect(text).toMatch(/reportClientEvent\(level, full \? 'album-full' : sample\.kind, sample\.msg, album\.id, \{/)
  })
  it('the save path asks the same questions of the real message and code', () => {
    const text = src()
    expect(text).toMatch(/const full = code === 'album_full'/)
    expect(text).toMatch(/const expectedSave = full \|\| isExpectedRefusal\(msg\)/)
    expect(text).toMatch(/reportClientEvent\(expectedSave \? 'warn' : 'error', full \? 'album-full' : 'save', msg, album\.id/)
  })
  it('a cancel never reaches the batch report: the upload path drops it by the error object', () => {
    expect(src()).toMatch(/if \(!\(e instanceof DOMException && e\.name === 'AbortError'\)\) \{\s+batchFailures\.push\(/)
  })
})

describe('UploadZone runs its video lane from lib/upload/video-lane and decides nothing about it here', () => {
  it('imports the rule and the classifier from the module', () => {
    const text = src()
    for (const name of ['createVideoLane', 'videoOutcomeOf']) {
      expect(text, name).toMatch(new RegExp(String.raw`import \{[^}]*\b` + name + String.raw`\b[^}]*\} from '@/lib/upload/video-lane'`, 's'))
    }
  })
  it('ONE lane for the whole session, built on the real semaphore and the real ceiling', () => {
    const text = src()
    // Per BATCH would be the defect back in a new costume: a lane that forgets it collapsed
    // re-widens on the next drop, on the same connection that just failed.
    expect(text).toMatch(/if \(!videoLaneRef\.current\) videoLaneRef\.current = createVideoLane\(videoSem, videoMax\)/)
    expect(text).toMatch(/const videoLane = videoLaneRef\.current/)
    // AND THE SEMAPHORE IT IS BUILT ON must be the session's too. A fresh Semaphore per batch
    // leaves the session-long lane calling setCapacity on one nothing waits on: video concurrency
    // is stuck at 1 from batch two onwards, and every assertion above stays green. Found by a
    // review on 2026-09-10, when this test was named for one lane and pinned only half of it.
    expect(text).toMatch(/if \(!videoSemRef\.current\) videoSemRef\.current = new Semaphore\(VIDEO_CONCURRENCY_START\)/)
  })
  it('the failure path hands the lane the REAL error, so a cancel is still a cancel', () => {
    // The shipped defect: a guest tapping cancel, or a video the product refused on purpose,
    // collapsed the lane to serial for the rest of the session. Only videoOutcomeOf(e) knows the
    // difference -- note('failed') here reads identically and is the bug, verbatim.
    expect(src()).toMatch(/if \(kind === 'video'\) videoLane\.note\(videoOutcomeOf\(e\)\)/)
  })
  it('a clean upload is reported too, or the lane never widens at all', () => {
    expect(src()).toMatch(/if \(kind === 'video'\) videoLane\.note\('clean'\)/)
  })
  it('the slot weight comes from the lane, given the real file size', () => {
    // A literal here (or entry.file.type, or a constant) makes every video take one slot, so a
    // 400 MB clip runs beside three others on a venue uplink.
    expect(src()).toMatch(/const weight = kind === 'video' \? videoLane\.weightFor\(entry\.file\.size\) : 1/)
  })
  it('keeps no copy of the rule: no streak, no ceiling, no setCapacity, no threshold', () => {
    const text = src()
    expect(text).not.toMatch(/videoStreakRef|videoCeilingRef|noteVideoOutcome|VIDEO_WIDEN_AFTER_CLEAN|VIDEO_SOLO_LANE_BYTES/)
    expect(text, 'only the lane may resize the video semaphore').not.toMatch(/videoSem(Ref\.current)?\.setCapacity/)
  })
})

describe('UploadZone measures a batch with a clock that cannot jump', () => {
  it('NO WALL-CLOCK READING SURVIVES IN THIS FILE AT ALL', () => {
    // Rule 22, as a whole-file rule rather than a line-by-line one. Date.now moves when a phone
    // takes an NTP or NITZ correction, when the time is set by hand, and when a device whose clock
    // was wrong corrects itself on boot -- all of which happen to phones at events, which is the
    // only place this component runs. Any duration derived from two of those readings is wrong by
    // the size of the jump, silently, in whichever direction it moved.
    //
    // Asserted as absence because that is the only form that stays true: a future edit that needs
    // "the time" reaches for Date.now by habit, and this fails in the same commit.
    // Every spelling, not just the one I happened to replace. `new Date().getTime()` is an equally
    // common habit and walked straight past the first version of this pin, as did Date.parse.
    const text = src()
    expect(text, 'Date.now').not.toMatch(/\bDate\.now\s*\(/)
    expect(text, 'new Date(...)').not.toMatch(/\bnew\s+Date\s*\(/)
    expect(text, 'Date.parse').not.toMatch(/\bDate\.parse\s*\(/)
  })

  it('the batch clock is monotonic, and the duration comes from lib/clock', () => {
    const text = src()
    expect(text).toMatch(/const batchStartedAt = monotonicNow\(\)/)
    // No `s` flag on this one: [^}] already matches newlines, and a literal regex with `s`
    // requires an es2018 target that tsconfig does not set.
    expect(text).toMatch(/import \{[^}]*\bmonotonicNow\b[^}]*\} from '@\/lib\/clock'/)
    expect(text).toMatch(/elapsedSince\(batchStartedAt\)/)
  })

  it('what counts as measurable, and what "lost" means, are the module\'s', () => {
    const text = src()
    // The real bytes, the real duration and the real saved count -- a literal in any of the three
    // reads identically at the call site and makes the dashboard number fiction.
    // deliveredBytes, NOT the bytes the batch set out to send. Ten photos totalling 30 MB with one
    // 3 MB photo landing in 60 seconds is 51 kB/s; measured against what was attempted it reads
    // 512 kB/s -- ten times too fast, for the worst upload of the night.
    expect(text).toMatch(/const kbps = batchThroughputKbps\(deliveredBytes, elapsedSince\(batchStartedAt\), savedCount\)/)
    expect(text, 'bytes are counted as each file lands, not summed up front').toMatch(/deliveredBytes \+= entry\.file\.size/)
    // ...and it STARTS at zero. Seeding it with the sum of what the batch set out to send passes
    // the line above untouched and puts the old, ten-times-too-fast number straight back.
    expect(text, 'the counter starts empty').toMatch(/let deliveredBytes = 0\b/)
    expect(text).toMatch(/const lost = lostCount\(toUpload\.length, savedCount\)/)
    // ...and no copy of the arithmetic stayed behind.
    expect(text).not.toMatch(/elapsedMs > 500|deliveredBytes \/ 1024|Math\.max\(0, toUpload\.length - savedCount\)/)
  })
})
