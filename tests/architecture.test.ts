import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments, stripMockPaths } from './helpers/source-text'

/**
 * Every matching file at ANY depth, absolute paths, deterministic order.
 *
 * The rules in this file are only worth what their walk can see, and the walk is where they have
 * failed twice. `readdirSync(dir).filter(f => f.endsWith('.ts'))` never matches a directory, so
 * everything under src/lib/server was exempt from "a new module arrives with its tests" without
 * anyone choosing that — which is how the authorization chain for 98.5% of all media reached
 * production untested through two rounds of adversarial review. Unrolling one level by hand fixed
 * the case that had already bitten and left the identical hole one level deeper.
 *
 * A recursive walk has no depth to get wrong. node_modules and dot-directories are skipped because
 * they are not ours.
 */
function walkTs(dir: string, match: RegExp): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkTs(full, match))
    else if (match.test(entry.name)) out.push(full)
  }
  return out
}

// A RATCHET, NOT A STANDARD.
//
// This file does not assert that the architecture is good. It asserts that it does not get worse.
//
// The problem it guards is measured, not felt: on 2026-08-30 src/components held 18,914 lines
// behind 7 tests while src/lib held 6,616 behind 139, and every defect two adversarial reviews
// found that week was in a component or a route handler — none in lib. Big components are where
// decisions hide, and a decision nothing can ask about is a bug nobody can see.
//
// Fixing that is months of work. Stopping it getting worse is one file. The numbers below are the
// state on the day it was written; they may go DOWN freely and every reduction should be recorded
// here. Raising one is allowed — some features really are big — but it must be a deliberate line
// in a commit rather than a file quietly growing by forty lines a week for a year, which is how
// every one of these got to its current size.

// NEWLINE via fromCharCode, with no backslash anywhere in this file.
//
// The first version wrote the escape directly and it was mangled on the way to disk, leaving a
// real line break inside a string literal and a file that would not parse. That is the same
// failure tests/source-hygiene.test.ts exists for, and the cheapest way to be immune to it is to
// not need an escape.
const NEWLINE = String.fromCharCode(10)

function lineCount(rel: string): number {
  const text = readFileSync(join(process.cwd(), rel), 'utf8')
  // Counted the way the budgets were measured (`grep -c ""`): the number of newlines. split()
  // returns one MORE than that when a file ends in a newline, and every file here does — without
  // this correction all ten budgets are off by one and fail on the first run.
  return text.split(NEWLINE).length - (text.endsWith(NEWLINE) ? 1 : 0)
}

// The files already too large to reason about. Ratcheted so they can only shrink.
const SIZE_BUDGET: Record<string, number> = {
  // 786 on 2026-08-30: the Admins & comped section now lists PEOPLE rather than subscription
  // rows — an admin's Max comes from code, not a row, so the owner's own account could never
  // appear — and the query gained the polar_product_id column its filter was silently reading as
  // undefined. Owner-requested fix; the lines are the loop that merges admins with comp rows.
  // +3 (2026-08-31): drop deleted-album rows from Top albums.
  // +6 (2026-08-31): error rows carry which album and owner to contact (the join itself lives
  // in lib/server/error-attribution, shared with the live poll).
  // +26 (2026-08-31): the card that says an advertised intro price cannot be charged.
  // +25 (2026-08-31): the card that says a Polar plan charges something other than the
  // advertised price or interval (lib/plan-catalogue + checkPlanProducts).
  // +1 (2026-09-04): one import line. The bucket name moved to r2BucketName() in lib/server, so
  // this page stops carrying its own copy of `R2_BUCKET_NAME ?? 'hushare-media'`. A line of import
  // bought the deletion of a duplicated fact, which is the trade this budget is meant to permit.
  'src/app/admin/page.tsx': 894,
  // +4 on 2026-08-30: FILE_ACCEPT stopped being a fourth hand-written copy of the accepted
  // MIME types and now builds from lib/media. An import and a comment cost four lines here
  // and removed a list that had already fallen two formats behind. Deliberate.
  // +18 (2026-08-31, audit): the parked-row retry now reads the server's refused list instead
  // of ticking every video green, including ones that were never written.
  // +4 (2026-08-31): the camera button explains what it does on a face-finder album, and goes
  // outline there so it stops outshouting "Find my photos".
  // +7 (2026-09-01): the owner's uploads keep full camera quality — maxDim threads through the
  // processors (the decision itself is lib/upload-policy's maxImageDimFor, tested there).
  // +2 (2026-09-01, review finding): isOwner joins startUploads' deps with the comment saying
  // why — the stale closure encoded the owner's first post-flip batch at guest size.
  // +6 (2026-09-01, security audit): the PUT carries exactly the content-type the server signed.
  // +12 (2026-09-01, incident): a missing-Content-Length 400 switches to the relay instead of
  // abandoning the video (the decision itself is lib/upload-policy, tested there).
  // +6 (2026-09-02): a guest was shown a Content-Security-Policy directive dump as the reason their
  // photo failed. Chrome on Android cannot decode HEIC natively, falls to the WASM converter, and
  // heic2any's `new Function` is refused by our CSP — so the conversion cannot run at all and no
  // retry helps. The classifier is in lib/upload-policy (tested); these lines are the branch that
  // uses it and the sentence a guest can act on.
  // +49 (2026-09-02): a second NATIVE decode attempt via WebCodecs ImageDecoder, so Chrome on
  // Android can decode HEIC without the WASM converter — whose `new Function` our CSP refuses,
  // leaving that guest unable to upload the photo at all. The alternatives were weakening
  // script-src for the whole site or telling them no; this is neither. Strictly additive: every
  // failure returns null and falls through to exactly the previous behaviour.
  // -54 (2026-09-02): both decode attempts moved to lib/image-decode with tests. Four mutations to
  // them had survived the whole suite while they sat here — deleting the WebCodecs attempt,
  // reversing the two attempts' order, dropping image.close(), and skipping isTypeSupported — which
  // is rule 14 stated as a measurement rather than an opinion. 10/10 killed after the move.
  // +18 (2026-09-03): the orientation fallback reports itself. decodeBitmapSafe retries WITHOUT
  // the EXIF-orientation option on any rejection, and on the old Android WebViews where that
  // option matters the retry returns an un-rotated bitmap — which the JPEG branch below then
  // re-encodes believing the rotation was applied, storing the photo sideways permanently with
  // nothing on screen and nothing in the panel. Narrowing the retry would turn a transient
  // failure into a failed upload, which is worse, so the invisible case is made visible instead.
  // Almost all of it is the comment saying why.
  // +14 (2026-09-05, review): both byte-transfer deadlines (putWithRetry and relayPut, the LAST
  // route the bytes have) moved onto the monotonic clock too. A forward clock step larger than the
  // 120s budget made either loop break on its FIRST check with the budget unspent — the guest told
  // their photo failed having spent none of its two minutes. Four `Date.now() + wait >= deadline`
  // comparisons per loop became one createDeadline each. createDeadline had shipped with zero
  // callers; a review pointed out that unused production code is the exact thing the previous
  // entry criticised.
  // +16 (2026-09-05): both stall watchdogs moved onto the monotonic clock. They compared two
  // Date.now() readings, so a backward clock step — an NTP correction on a phone that just joined
  // venue wifi, which is exactly when it syncs — made the difference NEGATIVE, the comparison never
  // became true, and the watchdog silently stopped existing. A guest watched a spinner forever. A
  // forward step aborted a healthy upload. The timers now live inside createStallWatch with the
  // decision they enforce (rule 15), where nine mutations are proven to kill them; here they were
  // bare setIntervals that nothing could test. Most of the addition is the two comments.
  'src/components/UploadZone.tsx': 2921,
  // +3 on 2026-08-30: the branding toggle gained a real plan check (it was dimmed but still
  // clickable), and Face Finder and bib search stopped riding on the collections flag. Three
  // lines of reasoning for three gates that were wrong. Deliberate.
  // +40 (2026-08-31): the desktop columns picker — a second, independent grid choice with
  // its own single-field save (lib/grid-columns.ts owns the values).
  // +4 (2026-08-31): albumPhotoCount prop so Download-all names the album, not the window.
  // 1827 (2026-08-31): the photo-order control was added and then removed the same day —
  // newest-first is right for essentially every album and dragging already covers the rest, so
  // the switch was not worth the room it took in Settings. Back to where it started.
  // +3 (2026-09-01): the package section refuses to offer a second purchase while one is in
  // flight — the prop and its plumbing.
  // +13: clearing mediaEditPendingRef when the panel-close effect cancels a pending save, and the
  // note explaining why. The ref was set on every scheduled edit and cleared only in the save's
  // finally, so cancelling the timer stranded it at true for the rest of the session and every
  // later close skipped the settings resync — which is how the phone/desktop grid "merge" came
  // back through a side door. Comment, not code, is most of the growth.
  // +60 (2026-09-03): the delete panel offers an UNDO. Deleting no longer destroys
  // anything for seven days (lib/album-bin), and an undo the owner cannot reach is not an undo —
  // telling them the album is restorable while offering no way to restore it would be a promise
  // the screen does not keep (rule 20). The redirect now waits behind a Restore/Done choice, and
  // the old "This cannot be undone" line is gone because it is no longer true.
  'src/components/OwnerToolbar.tsx': 2009,
  // +23 (2026-08-31): fallback-poll wiring for realtime REFUSAL — the cadence decision is in
  // lib/realtime-fallback.ts; the timer must live beside the channel it covers (rule 15).
  // +17 (2026-08-31, review finding): channel-identity guard + timer hygiene in the reconnect
  // loop, so a replaced channel's CLOSED echo cannot breed reconnect loops on venue WiFi.
  // +1 (2026-08-31): pass the true total to the toolbar.
  // +59 (2026-08-31, audit): the cheap freshness probe — every refresh now asks a ~40-byte
  // question before pulling a ~228 KB window, and the window is seeded from the server render.
  // +23 (2026-08-31): pending guest uploads move to their own review strip and out of the
  // album grid — see PendingReview.
  // +26 (2026-08-31, final audit): broadcasts bypass the probe, and pending photos are kept
  // out of the bib results and the counts that describe the grid.
  // +45 (2026-08-31, capacity audit): delta refresh — a live album fetches the few new photos
  // instead of the whole 500-row window, which measured 424 KB and was the real egress bill.
  // +17 (2026-09-01): the two package surfaces the money path was missing — the renewal card
  // (?renew=1, for an email opened without an owner link) and the post-payment banner
  // (?package=thanks, which Polar returns to with no owner fragment at all).
  // +21 (2026-09-01): the photo lists that feed the grid are memoised. Their IDENTITY is what
  // decides whether thousands of tiles re-render, and a bib search or a review queue was
  // rebuilding them on every parent render.
  // +5 (2026-09-01, incident): bibRange memoised for identity — a fresh {} in visiblePhotos'
  // deps re-rendered every tile during an active bib search.
  // +3 (2026-09-01): pass isOwner to UploadZone for the full-quality owner uploads.
  // +8: rate-limiting the forced full-window refetch a `changed` broadcast triggers. Anyone holding
  // an album link can publish to that channel with the public anon key, so an unbounded force turned
  // one forged message into a ~228-424 KB fetch on every connected phone, billed to the shared
  // database transfer allowance. The DECISION lives in lib/album-freshness (forcedRefreshAllowed,
  // tested including the clock-jump cases); what stayed here is the call and the stamp.
  // +20 (2026-09-02, live crash): five useMemo calls moved ABOVE the early returns, with the
  // reason written down. They sat below them, so a password-gated album -- server-rendered as the
  // guest prompt, hence initialAlbum null -- took an early return and called five FEWER hooks, and
  // React threw #310 the moment the guest's password was accepted and the album arrived. Two
  // reports from a real wedding album; 8 of 105 live albums are gated. Almost all the growth is
  // the comment, and it is worth the lines: this passed types, 1,100 tests and two adversarial
  // rounds, and only react-hooks/rules-of-hooks could see it. npm run check:hooks now gates it.
  // +10 (2026-09-04): one searchPhase() call plus the comment saying why. It REPLACED two derived
  // booleans (bibFailed, bibAwaitingServer) that only this file could combine — the grid could not,
  // so it printed "No photos with that number" while the bar said "Searching…". The decision now
  // lives in lib/search-answer with 11 tests; these lines are the wiring and the reason.
  // +9 (2026-09-04, review finding): a bib number that failed once stayed "Could not search just
  // now" for the whole session, above a grid already holding its results — the failure tag was set
  // but never retired on success. Clearing it is one line; the rest is why, because that ordering
  // in lib/search-answer depends on the tag describing the LATEST attempt.
  'src/app/[slug]/AlbumPageClient.tsx': 1782,
  'src/app/card-editor/CardEditorClient.tsx': 873,
  // +1 (2026-08-31): pass collectionTotal to the lightbox counter.
  // +2 (2026-08-31): morphAllowed gate on open and close.
  // +7 (2026-08-31): per-device column resolution feeding grid, masonry and the eager row.
  // +5 (2026-08-31, final audit): the close morph measures mounted tiles, not the slideshow subset.
  // +11 (2026-09-01): viewerPhotos resolves through a Map instead of .find-in-map. It was the
  // only quadratic path on the page — ~20.8M comparisons per render during a whole-album
  // slideshow — and the comment explaining why the .filter must stay is most of the growth.
  // 819 (2026-09-01): the tile list moved to photo-grid/PhotoTileList behind React.memo, so the
  // lightbox's own state stops re-rendering thousands of tiles. A reduction, locked in.
  // +2 (2026-09-01): the tile list takes the three album FIELDS it reads instead of the album
  // object, so a title or background edit no longer re-renders every tile.
  // +4 (2026-09-01, incident): the morph gate asks about the ALBUM, not the loaded window —
  // the comment carrying why is most of the growth. A fresh 499-tile load of a 4,566-photo
  // album ran the paint-suppressing view transition on every tap: the ten-second freeze.
  // +29 (2026-09-04): the empty state stopped being one boolean. `filtered` is true from the first
  // keystroke, so on a 5,000-photo album a runner outside the loaded window was told "No photos
  // with that number — try a different number" while the search was still in flight. Most of the
  // addition is the comment; the logic is a three-way read of lib/search-answer's phase, and the
  // subtitle is now withheld unless the answer is final (rule 20).
  // +10 (2026-09-04, review finding): role="status"/aria-live on the empty card, which is now the
  // answer to a question the guest asked and changes without a navigation — a screen-reader user
  // who typed a bib number heard nothing at all. `filtered` also stopped being a prop and is
  // derived from searchPhase, since two props for one fact could disagree.
  'src/components/PhotoGrid.tsx': 864,
  'src/components/AlbumDesigner.tsx': 774,
  // +3 net (2026-08-31): deleted the duplicate ±1 prefetch loop, added strip windowing wired
  // to lib/lightbox-plan.ts.
  // +43 (2026-08-31): the connected-swipe neighbour pane (the photo arriving rides beside the
  // one leaving) and the collectionTotal counter fix.
  // +5 (2026-08-31, review fold-in): slideshow counter uses its own complete set; the swipe
  // pane stays mounted through the failed-swipe return.
  // +6 (2026-08-31): swipe pane matches the real photo's box and vertical centre.
  // +8 (2026-08-31): the clamped downward nudge that puts the chevrons on the photo's centre.
  // +13 (2026-08-31, review finding): the chevron alignment moved from an inline transform —
  // which a filled animation silently overrode — to padding on the overlay root.
  // +7 (2026-09-01, incident): the swipe pane carries its own LB_PAD — absolute inset-0 does
  // NOT inherit the root's padding, so the arriving photo rode up to 44px high on phones.
  'src/components/photo-grid/LightboxOverlay.tsx': 731,
  // 518, down from 645: validatePhoto, hasTraversal and r2UrlPrefix moved to lib/photo-input,
  // where 22 tests now cover the boundary between a guest and this album's storage — including the
  // poisoned-thumbnail attack, which the mutation run confirmed they catch.
  // +11 (2026-09-02): duration_seconds is clamped at zero on write, and the comment explaining
  // why. It was accepted unbounded and the column has no CHECK, so one request storing
  // -2000000000 drove an album's video total negative — videoBudgetExceeded clamps the TOTAL, read
  // it as zero, and that album's video budget was disabled permanently. Comment, not code, is most
  // of the growth, and it is the kind that has to survive the next reader.
  // +45 (2026-09-02): the album is charged the duration the SERVER approved, not the client's
  // second claim. The client declared a video's length twice — once to /api/upload/stream, where it
  // was checked against the minute pool, and again here, which is the number that got written and
  // summed. Declaring one second bought a 62-second Cloudflare reservation, so a real 62-second
  // video uploaded fine while the album's total rose by one. Most of the growth is the comment
  // explaining that, at the two places someone would otherwise "simplify" it back.
  // +18 (2026-09-02, round 3): the client's duration_seconds is no longer written at all — the
  // previous version took it whenever the server had none, which two requests and zero bytes could
  // force, storing 2147483647 and making the album permanently refuse video. Plus the retry-token
  // lookup carrying the stored duration, so a re-saved video is not charged the client's claim.
  // +3 (2026-09-05): a narrowing the typed Supabase client requires, because stream_uid is nullable
  // in the schema. NOT a bug fix — a review proved SQL IN never matches NULL, so the null this
  // guards against could not reach that loop. The raise is bought with a guard and an honest note,
  // which is a weaker justification than the one first written here, and the entry says so.
  'src/app/api/album/photos/create/route.ts': 616,
  // +6 (2026-08-31, audit): progress comes from the server's outstanding count, not from the
  // length of a page that PostgREST had silently truncated.
  // +24 (2026-08-31, final audit): indexing pages until the server says it is finished, instead
  // of stopping after the first 1,000 and searching as though the job were done.
  'src/components/FaceFinder.tsx': 573,
}

describe('the big files do not get bigger', () => {
  for (const [file, budget] of Object.entries(SIZE_BUDGET)) {
    it(`${file.replace('src/', '')} stays within ${budget} lines`, () => {
      const actual = lineCount(file)
      expect(
        actual,
        `${file} is ${actual} lines, budget ${budget}. If this growth is deliberate, raise the ` +
          `number here in the same commit — that is the whole point, the growth should be visible. ` +
          `If it is not, the new logic probably belongs in src/lib where it can be tested.`,
      ).toBeLessThanOrEqual(budget)
    })
  }

  it('records a reduction rather than leaving slack', () => {
    // A budget well above the real size is not a ratchet, it is permission. Anything that has
    // shrunk by more than a little should have its number brought down in the same commit, or the
    // room it left is silently available again.
    const slack = Object.entries(SIZE_BUDGET)
      .map(([f, b]) => ({ f, slack: b - lineCount(f) }))
      .filter((x) => x.slack > 40)
    expect(
      slack.map((x) => `${x.f} is ${x.slack} lines under budget`),
      'these shrank — lower their budgets to lock the win in',
    ).toEqual([])
  })
})

// EVERY NEW MODULE IN src/lib IS TESTED.
//
// src/lib is where decisions go to become testable. A module added there with no test defeats the
// entire point of moving it — it is the same untestable logic with a longer import path.
//
// The list below is what was already untested when this rule was written. It is a debt register,
// not permission: names may be REMOVED as tests arrive, never added. A new file in src/lib with no
// test fails this immediately.
// 'email' came off on 2026-09-02, and the claim is deliberately partial: tests/error-spike-email
// renders the error-spike template through the real sendEmail and reads back the exact JSON Resend
// would receive, covering its escaping, its HTML/plain-text agreement and its three owner states.
// The file's five other senders are still uncovered. It is off the register because the register is
// about "nothing here is tested at all", and that is no longer true of this file — the one that
// writes customer email addresses and customer-written titles into an operator's inbox.
const UNTESTED_LEGACY = new Set([
  'access', 'album-backgrounds', 'analytics', 'auth',
  'broadcast', 'cf-analytics', 'constants', 'country-names', 'engagement', 'exif',
  'heic-worker', 'my-albums', 'polls', 'provision-user',
  'rekognition', 'report-server-error', 'slideshow-motion', 'useIsNarrow', 'utils',

  // ── Added 2026-09-02, when this rule learned to look one directory down ────────────────────
  //
  // These are not NEW debt. They are debt that was invisible: the walk only matched files ending
  // in .ts at the top level, and directories do not, so three whole folders were exempt from the
  // "a new module arrives with its tests" rule without anyone deciding that.
  //
  // server/image-upload-authorization came OFF the same day it went on — it was first on the list
  // for a reason (the entire authorization chain for 98.5% of all media) and
  // tests/image-upload-authorization.test.ts now covers the gate, both size ceilings, the type
  // allowlist, both rate limiters and their fail direction, package entitlement, and the ordering
  // that refuses an absurd size before it costs a database lookup. Six of seven hostile mutations
  // died on the first run; the seventh turned out to be a genuine finding rather than a weak test.
  //
  // Decision-carrying, worth tests in roughly this order next.
  'server/polar-reconcile', 'server/count-albums-against-cap', 'server/bib-index',
  'server/face-sweep', 'server/album-header',
  // Thin I/O wrappers around Cloudflare and Supabase clients. Genuinely low-value to unit test —
  // they are the boundary the other tests mock — but listed rather than exempted, so the choice is
  // visible and arguable instead of silent.
  'cloudflare/stream', 'cloudflare/stream-player',
  'supabase/admin', 'supabase/client', 'supabase/server',
])

describe('a new decision module arrives with its tests', () => {
  // MOCKING A MODULE IS NOT TESTING IT. vi.mock('@/lib/x') replaces x with a stub so that something
  // ELSE can be tested; it asserts nothing whatsoever about x. Counting those references marked
  // lib/report-server-error as "tested now, take it off the register" the moment an unrelated test
  // stubbed it — which would have swapped a truthful debt entry for a false claim of coverage, in
  // the one file whose whole job is to keep that register honest.
  //
  // Both strippers live in tests/helpers/source-text.ts now — the SQL guard needed the same idea and
  // a second copy of "how do I stop a comment answering my grep" is exactly what rule 13 forbids.
  // Their own tests moved there with them.
  const testSource = walkTs(join(process.cwd(), 'tests'), /\.tsx?$/)
    .map((f) => stripMockPaths(stripJsComments(readFileSync(f, 'utf8'))))
    .join('\n')

  // ONE LEVEL DOWN AS WELL. `readdirSync(...).filter(f => f.endsWith('.ts'))` only ever saw
  // top-level files, because directories do not end in .ts — so everything under src/lib/server,
  // src/lib/cloudflare and src/lib/supabase was exempt from this rule entirely, silently.
  //
  // That is not a theoretical gap. src/lib/server/image-upload-authorization.ts — the whole
  // authorization chain for the image path, which is 98.5% of all media, carrying the same gate,
  // the same per-tier cap and the same per-album ceiling as the video path — has no test at all,
  // and went unnoticed through two rounds of adversarial review because this walk could not see it.
  // The rule the video module was just held to would not have applied to the video module either.
  // Fixed once by hand-unrolling ONE level, which left `src/lib/a/b.ts` covered and `src/lib/a/b/c.ts`
  // exempt — the same silent hole one level deeper, waiting for the first module to be filed two
  // deep. It walks all the way down now.
  const libRoot = join(process.cwd(), 'src', 'lib')
  const libs = walkTs(libRoot, /\.ts$/)
    .map((f) => f.slice(libRoot.length + 1).replace(/\\/g, '/').replace(/\.ts$/, ''))

  // THE RULE'S OWN MACHINERY, TESTED. Everything above is only worth what the walk can see and what
  // the strippers remove, and BOTH have already failed silently — the walk skipped a whole directory
  // for months, and the stripper marked a module covered because a comment in this very file named
  // it. A rule whose reach is not itself asserted is a rule that reports "all clear" from a blind
  // spot, which is worse than not having it (rule 20). Literal inputs, so nothing here can drift
  // with the repo's contents.
  describe('the guard can actually see what it claims to', () => {
    it('walks past the first directory level', () => {
      expect(libs, 'one level down').toContain('server/album-access')
      // Depth 2 is the hole the hand-unrolled fix left. Asserted against the walk, not the disk, by
      // giving it a tree it must descend twice.
      const deep = walkTs(join(process.cwd(), 'src', 'app', 'api'), /route\.ts$/)
      expect(deep.length, 'src/app/api nests several levels deep').toBeGreaterThan(20)
    })

    // The strippers' own cases moved to tests/helpers/source-text.test.ts along with the strippers
    // themselves — the SQL guard needed the same idea, and a second copy of "stop a comment
    // answering my grep" is what rule 13 forbids. What stays here is the half specific to this
    // file: how far the walk reaches.
  })

  /**
   * Does any test actually IMPORT this module?
   *
   * It used to be enough for the module's path to appear anywhere in the test sources, and it was
   * written out twice, identically, in the two tests below — one fact, two copies, which is the
   * shape rule 13 is about.
   *
   * The text match was also wrong, and tests/boundaries.test.ts proved it: that file lists
   * '@/lib/supabase/admin' as a FORBIDDEN specifier — naming it precisely to assert nothing reaches
   * it — and the register immediately reported admin.ts as "tested now, take it off". Removing it
   * would have swapped a truthful debt entry for a false claim of coverage on the module that holds
   * the service-role key.
   *
   * Requiring an import POSITION is both narrower and closer to what "tested" means. Static and
   * dynamic forms both count; a mention in a string, an array or a comment does not. This is the
   * same idea as stripMockPaths, which exists because a vi.mock() of a module is not a test of it.
   */
  function isTested(name: string): boolean {
    const paths = [`@/lib/${name}`, `../src/lib/${name}`]
    return paths.some((p) => {
      const quoted = `['"]${p.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`)}['"]`
      return new RegExp(`from\\s*${quoted}`).test(testSource)
        || new RegExp(`import\\s*\\(\\s*${quoted}`).test(testSource)
    })
  }

  it('has no untested module that is not already on the debt register', () => {
    const offenders = libs.filter((l) => !isTested(l) && !UNTESTED_LEGACY.has(l))
    expect(
      offenders,
      'a module in src/lib with no test is untestable logic with a longer import path — which is ' +
        'the thing moving it there was meant to fix. Add a test, or say why it cannot have one by ' +
        'putting it on the register above.',
    ).toEqual([])
  })

  it('shrinks the debt register as modules get tested', () => {
    // A name left on the register after its tests arrive makes the register lie, and a lying
    // register stops being read.
    const stale = [...UNTESTED_LEGACY].filter((name) => libs.includes(name) && isTested(name))
    expect(stale, 'these are tested now — take them off the register').toEqual([])
  })

  it('does not list modules that no longer exist', () => {
    const gone = [...UNTESTED_LEGACY].filter((name) => !libs.includes(name))
    expect(gone, 'these were deleted — take them off the register').toEqual([])
  })
})

// EVERY CRON ROUTE MUST ANSWER THE SCHEDULER.
//
// worker.ts POSTs each cron with `Bearer ${env.ALBUM_RETIREMENT_SECRET}`. A route that exports
// GET, or checks a differently-named secret, answers 405 or 503 to every scheduled run and never
// executes — while looking perfectly correct in the file and in review. Both mistakes were made
// in one afternoon writing a single new cron, and neither is visible without asking production.
// THE PRE-DEPLOY SCHEMA CHECK MUST KNOW ABOUT EVERY FUNCTION THE CODE CALLS.
//
// scripts/check-db.mjs asks the live database whether the things the app depends on are there, and
// fails the deploy when they are not. Its REQUIRED_FUNCTIONS list is hand-maintained, and it had
// fallen behind the code three times — most recently missing album_video_seconds, which is the
// entire video budget. A missing function does not throw at deploy time: PostgREST answers PGRST202
// at runtime, the budget's fail-open branch fires, and video is unbounded for every album on the
// platform while `npm run db:check` prints "all required ... functions ... present".
//
// So the list is derived from the code instead of remembered. This is the same shape as the cron
// literal check below: a hand-kept list beside a mechanical one, held together by a test.
describe('the pre-deploy schema check knows every function the code calls', () => {
  it('lists every .rpc() name in REQUIRED_FUNCTIONS', () => {
    const checkDb = readFileSync(join(process.cwd(), 'scripts', 'check-db.mjs'), 'utf8')
    const listed = new Set(
      (checkDb.match(/const REQUIRED_FUNCTIONS = \[([\s\S]*?)\]/) ?? ['', ''])[1]
        .match(/'([a-z0-9_]+)'/g)?.map((q) => q.slice(1, -1)) ?? [],
    )
    expect(listed.size, 'could not parse REQUIRED_FUNCTIONS out of check-db.mjs').toBeGreaterThan(0)

    // Comment-stripped, so a `.rpc('x')` written in an explanatory comment cannot invent a
    // requirement — the same trap that has now bitten three separate guards in this repo.
    const called = new Set<string>()
    for (const f of walkTs(join(process.cwd(), 'src'), /\.(ts|tsx)$/)) {
      const src = stripJsComments(readFileSync(f, 'utf8'))
      for (const m of src.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'/g)) called.add(m[1])
    }
    expect(called.size, 'no .rpc() calls found — the scan is broken, not the list').toBeGreaterThan(5)

    const missing = [...called].filter((n) => !listed.has(n)).sort()
    expect(
      missing,
      'these functions are called by src/ but are not checked before deploy. A database missing one '
      + 'of them fails at RUNTIME, on a path that usually errs open — add them to REQUIRED_FUNCTIONS '
      + 'in scripts/check-db.mjs.',
    ).toEqual([])
  })
})

describe('cron routes are reachable by the scheduler', () => {
  const dir = join(process.cwd(), 'src', 'app', 'api', 'cron')
  const routes = readdirSync(dir).filter((d) => !d.startsWith('.'))

  it('has at least the crons worker.ts schedules', () => {
    expect(routes.length).toBeGreaterThan(5)
  })

  for (const name of routes) {
    it(`${name} exports POST and checks ALBUM_RETIREMENT_SECRET`, () => {
      const src = readFileSync(join(dir, name, 'route.ts'), 'utf8')
      expect(src, `${name} must export POST — the scheduler only ever POSTs`).toMatch(/export async function POST\s*\(/)
      expect(src, `${name} must check the secret worker.ts actually sends`).toContain('ALBUM_RETIREMENT_SECRET')
      // NAMING the secret is not CHECKING it. This assertion used to be the `toContain` above and
      // nothing else, which the line `const secret = process.env.ALBUM_RETIREMENT_SECRET ?? ''`
      // satisfies all by itself — so replacing a route's entire auth guard with `if (false)` passed
      // all 901 tests, on every cron route at once. Found by mutation, not by reading.
      //
      // Still a source-text test and honest about it: it cannot prove the comparison runs before
      // the work. What it does prove is that the comparison EXISTS, which is what the mutation
      // removed. The three routes here word their guard differently but all reach timingSafeEqual.
      expect(src, `${name} must COMPARE the secret, not merely mention it`).toMatch(/timingSafeEqual\s*\(/)
    })
  }

  // A CRON STRING THAT DRIFTS FROM wrangler.toml SILENTLY STOPS THE WORK.
  //
  // worker.ts branches on `event.cron === '<literal>'` to decide which jobs a firing runs. If that
  // literal is not in wrangler.toml's crons list, the branch never matches, nothing throws, nothing
  // is logged, and the jobs simply never run again — which for cleanup-stream means the Cloudflare
  // Stream quota fills until video fails for every album. One fact in two files (rule 13).
  it('every cron literal worker.ts branches on is actually scheduled', () => {
    const worker = readFileSync(join(process.cwd(), 'worker.ts'), 'utf8')
    const wrangler = readFileSync(join(process.cwd(), 'wrangler.toml'), 'utf8')

    const scheduled = (/^crons\s*=\s*\[(.*)\]/m.exec(wrangler)?.[1] ?? '')
      .split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    expect(scheduled.length, 'could not read the crons list out of wrangler.toml').toBeGreaterThan(0)

    // The literals worker.ts compares event.cron against.
    const branched = [...worker.matchAll(/const\s+EVERY_[A-Z0-9_]+\s*=\s*'([^']+)'/g)].map((m) => m[1])
    expect(branched.length, 'no cron literals found in worker.ts').toBeGreaterThan(0)

    // BOTH DIRECTIONS. The first version checked only that every literal worker.ts names is
    // scheduled, and that is the half that could not see the real hole: the daily batch had NO
    // literal — it was the unnamed else-branch — so deleting "0 2 * * *" from wrangler.toml passed
    // the entire suite while seven jobs stopped forever, including the reconcile that stops a
    // paying customer silently dropping to free while Polar keeps charging them.
    for (const literal of branched) {
      expect(scheduled, `worker.ts branches on "${literal}" but wrangler.toml does not schedule it`)
        .toContain(literal)
    }
    // And the other way: a cron in wrangler.toml that worker.ts does not branch on now does
    // NOTHING (it used to fall through into the daily batch and email customers on whatever
    // cadence had been typed). Either way it is a mistake, and it is caught here rather than in
    // production.
    for (const literal of scheduled) {
      expect(branched, `wrangler.toml schedules "${literal}" but worker.ts has no branch for it, so it would run nothing`)
        .toContain(literal)
    }
  })
})
