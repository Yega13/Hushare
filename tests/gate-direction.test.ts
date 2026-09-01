import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// A PLAN GATE MUST ONLY RUN IN ONE DIRECTION: it may refuse to turn a paid feature ON, and it must
// never refuse to turn one OFF.
//
// This is not a style rule. Several routes checked the plan before the update regardless of which
// way the setting was moving, so an owner who was not on the plan any more — or who had set the
// thing while it was ungated — could not undo it. Found live on real albums: a free account with a
// custom logo it could not remove, another with sponsor logos and Face Finder indexing it could not
// switch off. The countdown reveal was the dangerous one: a future reveal date keeps the album
// SEALED, so freezing that setting locks an owner out of their own album until the clock runs out.
//
// api/album/branding and api/album/media-settings always had this right and say why in their own
// comments; the rest were brought into line. This pins all of them, because the failure is silent —
// nothing errors, nothing logs, and the owner simply cannot undo a choice.
//
// Each entry names the guard that must still surround the check. If a route is refactored, update
// the pattern deliberately — do not delete the entry to make the test pass.
const OFF_SWITCH_GUARDS: Record<string, RegExp> = {
  'api/album/reveal/route.ts': /if \(revealAt !== null\) \{[\s\S]{0,200}?refuseBelowTier/,
  'api/album/logo/route.ts': /if \(value !== null\) \{[\s\S]{0,200}?refuseBelowTier/,
  'api/album/sponsors/route.ts': /if \(addsSomething\) \{[\s\S]{0,200}?refuseBelowTier/,
  'api/album/bib-search/route.ts': /if \(enabled\) \{[\s\S]{0,200}?refuseBelowTier/,
  'api/album/custom-url/route.ts': /if \(newCustomSlug !== null\) \{[\s\S]{0,300}?refuseBelowTier/,
  'api/album/face-finder/route.ts': /if \(enabled\) \{[\s\S]{0,200}?refuseBelowTier/,
  'api/album/branding/route.ts': /if \(hide\) \{[\s\S]{0,300}?refuseBelowTier/,
  'api/album/media-settings/route.ts': /if \(updates\.require_approval === true\) \{[\s\S]{0,200}?refuseBelowTier/,
}

// EVERY GATED CONTROL MUST CARRY ITS MARK, and they had drifted apart badly.
//
// The server gated ten features. The owner toolbar showed a PRO/MAX badge on seven of them, and
// AlbumDesigner — which owns the custom logo and the sponsor marks, both gated — did not import
// PlanBadge at all and never even read the album's plan. So a free owner picked a logo file,
// waited for it to upload, and learned it was a paid feature from the error that came back.
// "Remove Hushare branding" was the same: an ordinary-looking switch that simply refused.
//
// The dimming had drifted too — 0.6 here, 0.55 there, several rows not dimmed at all, and one icon
// hand-coloured grey while the icons beside it stayed in colour. gatedRowStyle() is now the single
// definition, and grayscale(1) means a row added later cannot forget to grey its own icon.
// EVERY ROUTE THAT READS ALBUM DATA APPLIES THE PASSWORD AND REVEAL GATE.
//
// This class has now been missed three separate times, and the third was proved exploitable against
// a live password-protected album: api/album/face-search ran an AWS Rekognition face search knowing
// only the slug — no password, no reveal, no owner link. An attacker could upload a photo of a
// specific person and be told whether they appear in a locked album, with matching photo ids and
// similarity scores. Biometric confirmation about someone who never consented, on an album its
// owner had deliberately closed, billed to that owner.
//
// Its sibling api/album/face-index GET already had the check, with a comment explaining exactly
// why. Being one file apart was not enough to keep them in step, so the rule is asserted here.
// Paths are relative to src/. Some routes gate through a shared helper rather than calling
// gateAllowsContribution themselves — api/upload/presign delegates to
// lib/server/image-upload-authorization, which is where its check lives — so the helper is listed
// instead of the route. Listing the route would have failed against perfectly correct code.
const READ_PATHS_NEEDING_THE_GATE = [
  'app/api/album/face-search/route.ts',
  'app/api/album/face-index/route.ts',
  'app/api/album/photos/create/route.ts',
  'app/api/upload/stream/route.ts',
  'lib/server/image-upload-authorization.ts',
]

describe('every album-reading route applies the password and reveal gate', () => {
  for (const route of READ_PATHS_NEEDING_THE_GATE) {
    it(`${route} calls gateAllowsContribution`, () => {
      const source = readFileSync(join(process.cwd(), 'src', ...route.split('/')), 'utf8')
      expect(
        source.includes('gateAllowsContribution'),
        `${route} reads or writes album data without checking the album's password and reveal ` +
          `date. Knowing the slug must never be enough.`,
      ).toBe(true)
    })
  }
})

describe('every server-gated control shows which plan it needs', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8')

  it('badges every gated control in the owner toolbar', () => {
    const source = read('components/OwnerToolbar.tsx')
    // The EXACT call, not a prefix: `ot.customUrl` also matches `ot.customUrlCleared` in a toast
    // a thousand lines earlier, and the first draft of this test matched that and failed on code
    // that was perfectly correct.
    for (const key of ['ot.liveWall', 'ot.requireApproval', 'ot.faceFinder', 'ot.bibSearch', 'ot.customUrl', 'ot.delayedReveal', 'ot.collections']) {
      const label = `t('${key}')`
      const at = source.indexOf(label)
      expect(at, `${label} is missing from the toolbar entirely`).toBeGreaterThan(-1)
      // The badge sits on the same line or the next one, so look at a small window after the label.
      expect(
        source.slice(at, at + 220).includes('PlanBadge'),
        `${label} is gated on the server but shows no PRO/MAX badge`,
      ).toBe(true)
    }
  })

  it('badges branding removal, which had none', () => {
    const source = read('components/OwnerToolbar.tsx')
    const at = source.indexOf('Remove Hushare branding')
    expect(at).toBeGreaterThan(-1)
    expect(
      source.slice(at, at + 220).includes('PlanBadge'),
      'api/album/branding gates this on Pro — the row must say so before it is used',
    ).toBe(true)
  })

  it('makes the album designer plan-aware for the logo and sponsor marks', () => {
    const source = read('components/AlbumDesigner.tsx')
    expect(source.includes('PlanBadge'), 'AlbumDesigner must import PlanBadge').toBe(true)
    expect(source.includes('album.plan'), 'AlbumDesigner must read the OWNER tier from the album').toBe(true)
    for (const [label, need] of [['ad.logo', 'pro'], ['ad.sponsors', 'studio']] as const) {
      const at = source.indexOf(label)
      expect(at, `${label} missing`).toBeGreaterThan(-1)
      const window = source.slice(at, at + 200)
      expect(window.includes(`need="${need}"`), `${label} must carry a ${need.toUpperCase()} badge`).toBe(true)
    }
  })

  it('uses ONE definition for how a gated control looks', () => {
    const badge = read('components/PlanBadge.tsx')
    expect(badge.includes('grayscale(1)'), 'gatedRowStyle must grey the whole row, icons included').toBe(true)
    for (const rel of ['components/OwnerToolbar.tsx', 'components/AlbumDesigner.tsx']) {
      const source = read(rel)
      expect(source.includes('gatedRowStyle'), `${rel} must use the shared gated style`).toBe(true)
      // The hand-rolled dims this replaced. Any of them coming back means the look has drifted again.
      expect(
        /opacity: \w+ \? 0\.6 : 1/.test(source),
        `${rel} has a hand-rolled dim again — use gatedRowStyle`,
      ).toBe(false)
    }
  })
})

// A COLLABORATION ALBUM KEEPS THE HUSHARE MARK, and that has to hold in two places.
//
// These albums are given Max for free in exchange for carrying our name in front of everyone who
// opens them, so the mark is the consideration in the deal. Max includes "remove Hushare branding"
// as one toggle. Refusing the write is not enough on its own: hide_branding has already once
// survived a cancelled subscription forever because nothing re-checked it at READ time, and a
// value stored before a lock would do exactly the same thing.
describe('a collaboration album cannot hide the Hushare mark', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8')

  it('refuses the write while the album is locked', () => {
    const source = read('app/api/album/branding/route.ts')
    expect(
      /if \(hide && access\.album\.branding_locked\)/.test(source),
      'api/album/branding must refuse to hide the mark on a locked album',
    ).toBe(true)
  })

  it('forces the mark back on when the album is read', () => {
    const source = read('lib/server/album-access.ts')
    expect(
      // `.` already stops at a newline, so this stays on one line without needing an escape that
      // a shell or script could eat on the way to disk — see tests/source-hygiene.test.ts.
      /hide_branding:.*!album\.branding_locked/.test(source),
      'resolveAlbum must AND !branding_locked into hide_branding, so a value stored before the ' +
        'lock cannot keep taking effect',
    ).toBe(true)
  })
})

describe('a paid mark does not outlive the plan that paid for it', () => {
  // hide_branding already had this fix and its comment says why: a value stored while the album was
  // paid kept taking effect after the payment stopped, because the gate ran only at WRITE time.
  // The album logo (Pro) and the sponsor marks (Max) were left in exactly that state — one month of
  // Pro at the intro price bought a custom logo on every album, permanently.
  //
  // Read-time masks, checked at the source, because resolveAlbum is a database call and this is a
  // one-line expression inside it — the same way the branding mask beside it is checked.
  const read = (rel: string) => readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8')

  it('the album logo is withheld from a free album', () => {
    expect(
      /logo_url:.*effectiveTier !== 'free'.*: null/.test(read('lib/server/album-access.ts')),
      "resolveAlbum must withhold logo_url when the album's effective tier is free",
    ).toBe(true)
  })

  it('sponsor marks are withheld below Max', () => {
    expect(
      /sponsor_logos:.*effectiveTier === 'studio'/.test(read('lib/server/album-access.ts')),
      'resolveAlbum must withhold sponsor_logos unless the album is entitled to Max',
    ).toBe(true)
  })

  it('but the OWNER always sees their own marks', () => {
    // AlbumDesigner renders album.logo_url as the owner's current logo. Masking it for them too
    // shows an empty slot on a file we still hold, and the honest reading of that is "Hushare
    // deleted my logo" — so the owner keeps seeing their own asset with the plan badge beside it.
    // The leak being closed is PUBLISHING the mark, not the owner knowing it exists.
    const src = read('lib/server/album-access.ts')
    expect(/logo_url: \(isOwner \|\|/.test(src), 'logo_url must pass through for the owner').toBe(true)
    expect(/sponsor_logos: \(isOwner \|\|/.test(src), 'sponsor_logos must pass through for the owner').toBe(true)
  })

  it('both are masked on the ALBUM tier, so a package still unlocks them', () => {
    // effectiveTier, never ownerTier: a Max Package bought for a free account is exactly the
    // customer these marks are sold to, and masking on the account would blank what they paid for.
    const src = read('lib/server/album-access.ts')
    expect(/logo_url:.*ownerTier/.test(src)).toBe(false)
    expect(/sponsor_logos:.*ownerTier/.test(src)).toBe(false)
  })
})

describe('a plan gate never blocks turning a feature off', () => {
  for (const [route, guard] of Object.entries(OFF_SWITCH_GUARDS)) {
    it(`${route} gates only the "on" direction`, () => {
      const source = readFileSync(join(process.cwd(), 'src', 'app', ...route.split('/')), 'utf8')
      expect(
        guard.test(source),
        `${route}: the plan check is no longer wrapped in a guard that limits it to turning the ` +
          `feature ON. An owner off the plan must always be able to switch it back off.`,
      ).toBe(true)
    })
  }
})
