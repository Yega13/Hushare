import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

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
  'src/app/admin/page.tsx': 893,
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
  'src/components/UploadZone.tsx': 2927,
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
  'src/components/OwnerToolbar.tsx': 1949,
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
  'src/app/[slug]/AlbumPageClient.tsx': 1743,
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
  'src/components/PhotoGrid.tsx': 825,
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
  'src/app/api/album/photos/create/route.ts': 610,
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
  const testSource = readdirSync(join(process.cwd(), 'tests'))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => readFileSync(join(process.cwd(), 'tests', f), 'utf8'))
    .join('\n')
    .split('\n')
    .filter((line) => !/vi\.mock\s*\(/.test(line))
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
  const libs = [
    ...readdirSync(join(process.cwd(), 'src', 'lib'), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.ts'))
      .map((e) => e.name.replace(/\.ts$/, '')),
    ...readdirSync(join(process.cwd(), 'src', 'lib'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .flatMap((dir) =>
        readdirSync(join(process.cwd(), 'src', 'lib', dir.name), { withFileTypes: true })
          .filter((e) => e.isFile() && e.name.endsWith('.ts'))
          .map((e) => `${dir.name}/${e.name.replace(/\.ts$/, '')}`)),
  ]

  it('has no untested module that is not already on the debt register', () => {
    const isTested = (name: string) =>
      testSource.includes(`@/lib/${name}'`) || testSource.includes(`../src/lib/${name}'`)
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
    const isTested = (name: string) =>
      testSource.includes(`@/lib/${name}'`) || testSource.includes(`../src/lib/${name}'`)
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
