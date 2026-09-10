import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'

// THE MODULES ARE PROVEN. THIS PINS THE LINES THAT DECIDE WHETHER THEY RUN.
//
// lib/resolve-outcome and lib/grid-visibility each have tests and a mutation set. Neither says
// anything about the call site, and MISTAKES entry 10 is that failure recorded four times:
// "extracting logic into src/lib moves the thing I can test and leaves behind the thing that
// decides whether it runs". A call site passing `true` for `res.ok`, or `[]` for the photos, is
// green in every module test and wrong on every album.
//
// UNLIKE album-page-search-wiring.test.ts, the NAMES are pinned here. A reviewer showed eight
// wrong call sites -- the Response object for the body, `isOwner` for `effectiveIsOwner`, `null`
// for the pending ids, `photos` for the published list -- that a shape-only check let through,
// each an identifier and each a defect on every album. When every wrong name is equally "derived",
// the name is the contract. Comments are stripped first.

const SOURCE = join(process.cwd(), 'src', 'app', '[slug]', 'AlbumPageClient.tsx')
const src = () => stripJsComments(readFileSync(SOURCE, 'utf8'))

function singleCall(text: string, marker: string): string {
  const start = text.indexOf(marker)
  expect(start, `AlbumPageClient must call ${marker} exactly once`).toBeGreaterThan(-1)
  expect(text.indexOf(marker, start + 1), `a second ${marker} call means this guard pins only one of them`).toBe(-1)
  // The call's argument list, up to the matching close paren.
  let depth = 0
  for (let i = start + marker.length - 1; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  throw new Error(`unbalanced call at ${marker}`)
}

describe('AlbumPageClient wires the resolve outcome from the real response', () => {
  it('classifyResolve gets the status, the ok flag, and the parsed body -- no literals', () => {
    const call = singleCall(src(), 'classifyResolve(')
    expect(call).toMatch(/classifyResolve\(\s*res\.status\s*,\s*res\.ok\s*,\s*json\s*\)/)
  })
  it('every outcome kind is handled, and only the album kind falls through', () => {
    const text = src()
    for (const kind of ['not-found', 'error', 'password', 'reveal', 'album']) {
      expect(text, `outcome '${kind}' has no case`).toContain(`case '${kind}':`)
    }
    // The gate cases must set the gate the outcome carries, not something else.
    expect(text).toMatch(/case 'password':\s*setPasswordGate\(\{\s*slug:\s*outcome\.slug/)
    expect(text).toMatch(/case 'reveal':\s*setRevealGate\(\{\s*revealAt:\s*outcome\.revealAt/)
    expect(text).toMatch(/case 'not-found':\s*setIsNotFound\(true\)/)
    expect(text).toMatch(/case 'error':\s*setNetworkError\(true\)/)
    // The album case must fall through to the album, not return before it loads.
    expect(text).toMatch(/case 'album':\s*break/)
    expect(text).toMatch(/const data = outcome\.album/)
  })
})

describe('AlbumPageClient wires the grid visibility from the real state', () => {
  it('partitionPending gets the photos and a DERIVED owner flag and approval flag', () => {
    const call = singleCall(src(), 'partitionPending(')
    // effectiveIsOwner, not isOwner: the owner-token-in-URL gate the file defends at length.
    expect(call).toMatch(/partitionPending\(\s*photos\s*,\s*\{\s*isOwner:\s*effectiveIsOwner\s*,\s*requireApproval\s*\}\s*\)/)
  })
  it('the requireApproval flag is read from the album, not assumed', () => {
    expect(src()).toMatch(/const requireApproval = album\?\.require_approval === true/)
  })
  it('visiblePhotos gets the server answer flag and the server rows, derived', () => {
    const call = singleCall(src(), 'visiblePhotosOf(')
    expect(call).toMatch(/published:\s*publishedPhotos\b/)
    expect(call).toMatch(/\bpendingIds\s*[,}]/)          // shorthand: the memoised set, not overridden
    expect(call).toMatch(/\bbibEnabled\s*[,}]/)
    expect(call).toMatch(/query:\s*bibDigits\b/)
    expect(call).toMatch(/serverAnswered:\s*bibServerAnswered\b/)
    expect(call).toMatch(/serverPhotos:\s*bibServerPhotos\b/)
    expect(call).toMatch(/range:\s*bibRange\b/)
    expect(call).not.toMatch(/\bnull\b|\b(true|false)\b|\[\]/)
  })
  it('the published count the guest-facing label uses comes from the module', () => {
    expect(src()).toMatch(/publishedCountOf\(\s*total\s*,\s*pendingPhotos\.length\s*\)/)
  })
})

describe('AlbumPageClient wires the freshness seed and the delta merge from the real inputs', () => {
  it('the seed reads the SSR window, its total, and the album order', () => {
    const call = singleCall(src(), 'initialFreshness(')
    expect(call).toMatch(/initialFreshness\(\s*initialPhotos\s*,\s*initialTotal\s*,\s*album\?\.photo_order\s*\)/)
  })
  it('delta rows merge into the previous list in the album order the ref carries', () => {
    const call = singleCall(src(), 'mergeDelta(')
    expect(call).toMatch(/mergeDelta\(\s*prev\s*,\s*fresh\.photos\s*,\s*albumOrderRef\.current\s*\)/)
    // ...and its result is what the state becomes, not computed and dropped.
    expect(src()).toMatch(/setPhotos\(prev => mergeDelta\(/)
  })
})

describe('AlbumPageClient wires the leave-intent decisions from the real event', () => {
  it('a back press asks isRealLeavePop with the history state', () => {
    expect(src()).toMatch(/if \(isRealLeavePop\(e\.state\)\) trigger\(\)/)
  })
  it('a click hands leaveDestination every predicate from the event and the anchor, and the real location', () => {
    const call = singleCall(src(), 'leaveDestination(')
    for (const pair of ['button: e.button', 'metaKey: e.metaKey', 'ctrlKey: e.ctrlKey', 'shiftKey: e.shiftKey', 'altKey: e.altKey',
      'defaultPrevented: e.defaultPrevented', "href: anchor?.getAttribute('href') ?? null", "download: anchor?.hasAttribute('download') ?? false",
      "target: anchor?.getAttribute('target') ?? null"]) {
      expect(call, pair).toContain(pair)
    }
    expect(call).toMatch(/\},\s*window\.location\s*\)$/)
  })
  it('the anchor is the closest <a>, and a leave is STOPPED before Next navigates (rule 15: the enforcement)', () => {
    const text = src()
    expect(text).toMatch(/const anchor = \(e\.target as HTMLElement \| null\)\?\.closest\?\.\('a'\) \?\? null/)
    expect(text).toMatch(/if \(!dest\) return\s+e\.preventDefault\(\)\s+e\.stopImmediatePropagation\(\)\s+pendingLeaveHrefRef\.current = dest\s+trigger\(\)/)
  })
})

describe('AlbumPageClient reads the owner link through one reader and verifies it through the loop', () => {
  it('every owner-token read goes through ownerTokenFromHash(window.location.hash); no ad-hoc parse remains', () => {
    const text = src()
    expect(text.match(/ownerTokenFromHash\(window\.location\.hash\)/g)?.length).toBe(3)
    expect(text).not.toMatch(/get\('owner'\)/)
  })
  it('the owner-login call goes through verifyOwnerToken with the real slug, token and the loop signal', () => {
    const call = singleCall(src(), 'verifyOwnerToken(')
    expect(call).toMatch(/fetch\('\/api\/album\/owner-login'/)
    expect(call).toMatch(/owner_token:\s*token\b/)
    expect(call).toMatch(/\bslug\b/)
    expect(call).toMatch(/\bsignal,?\s*\}\)/)
  })
})

describe('AlbumPageClient hands the photos channel to the supervisor and keeps only the socket', () => {
  it('the supervisor is built with connect, the probe-first refresh with the force flag, the wall clock and the debounce', () => {
    const call = singleCall(src(), 'createChannelSupervisor(')
    expect(call).toMatch(/connect:\s*\(\)\s*=>\s*connect\(\)/)
    expect(call).toMatch(/refresh:\s*\(\{\s*force\s*\}\)\s*=>\s*\{\s*void refreshIfChanged\(albumId, r => \{ if \(active\) applyWindowRefresh\(r\) \}, \{ force \}\)/)
    expect(call).toMatch(/now:\s*\(\)\s*=>\s*Date\.now\(\)/)
    expect(call).toMatch(/debounceMs:\s*REFETCH_DEBOUNCE_MS\b/)
  })
  it('a broadcast goes to onChanged, a status event goes to onStatus AFTER the identity guard, and cleanup disposes', () => {
    const text = src()
    expect(text).toMatch(/\.on\('broadcast', \{ event: 'changed' \}, \(\) => \{ if \(active\) supervisor\.onChanged\(\) \}\)/)
    expect(text).toMatch(/if \(!active \|\| ch !== currentChannel\) return\s+if \(status === 'SUBSCRIBED' \|\| status === 'CHANNEL_ERROR' \|\| status === 'TIMED_OUT' \|\| status === 'CLOSED'\) \{\s+supervisor\.onStatus\(status\)/)
    expect(text).toMatch(/active = false\s+supervisor\.dispose\(\)\s+if \(currentChannel\) supabase\.removeChannel\(currentChannel\)/)
  })
  it('connect() nulls the current channel BEFORE removing the old one (167023e: the synchronous CLOSED echo must miss the guard)', () => {
    expect(src()).toMatch(/const prev = currentChannel\s+currentChannel = null\s+if \(prev\) supabase\.removeChannel\(prev\)/)
  })
  it('no timer of the photos channel is left in the component', () => {
    const text = src()
    expect(text).not.toMatch(/retryTimer|pollTimer|refetchTimer|fallbackPollDelay|forcedRefreshAllowed/)
  })
})

describe('AlbumPageClient hands settings-sync the refetch itself; the jitter is the module\'s', () => {
  it('refetch is refetchSettings, with no timer or random source at the call site', () => {
    const call = singleCall(src(), 'createSettingsSync(')
    expect(call).toMatch(/refetch:\s*refetchSettings\s*,/)
    expect(call).not.toMatch(/setTimeout|Math\.random/)
  })
})

describe('AlbumPageClient runs the upload refresh through delayed-once, and cancels it at every exit', () => {
  it('one scheduler, created once, at the product delay', () => {
    expect(src()).toMatch(/const \[uploadRefresh\] = useState\(\(\) => createDelayedOnce\(\{ delayMs: UPLOAD_REFRESH_DELAY_MS \}\)\)/)
    expect(src()).toMatch(/const UPLOAD_REFRESH_DELAY_MS = 3000/)
  })
  it('an upload requests the forced, merging refresh for the album it happened on', () => {
    expect(src()).toMatch(/uploadRefresh\.request\(\(\) => runUploadRefresh\(uploadAlbumId\)\)/)
    const run = singleCall(src(), 'runUploadRefresh = useCallback(')
    expect(run).toMatch(/refreshIfChanged\(albumId,/)
    expect(run).toMatch(/\{ force: true \}/)
    expect(run).toMatch(/mergePreservingExtras\(prev, r\.photos\)/)
    expect(run).toMatch(/if \(!shouldApplyRefresh\(r\)\) return/)
  })
  it('cancelled on a slug change, on retry, and on unmount -- and nowhere is a bare timer left', () => {
    const text = src()
    expect(text.match(/uploadRefresh\.cancel\(\)/g)?.length).toBe(3)
    expect(text).not.toMatch(/uploadRefetchTimerRef/)
  })
})
