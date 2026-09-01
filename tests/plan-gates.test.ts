import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FEATURE_TIER, tierAllows, tierIsKnown, showsAsLocked, type PaidFeature } from '@/lib/plan-gates'

// WHAT A PLAN INCLUDES WAS WRITTEN DOWN FOUR TIMES, IN THREE DIFFERENT SHAPES.
//
// refuseBelowTier(...) in six routes; `if (tier === 'free')` in two more; `tier !== 'studio'` and
// albumHasTier(...) on two pages; and `userTier === 'pro' || userTier === 'studio'` in the toolbar
// that draws the badges. Nothing connected them, so repackaging a plan meant finding all four from
// memory — and missing one failed silently and one-sidedly: the server refused while the client
// showed an ordinary switch.
//
// That is not hypothetical. "Remove Hushare branding" was gated on the server and had no badge and
// no dimming, so a free owner flipped a normal-looking toggle and learned it was paid from the
// error. The album logo and the sponsor marks were the same.
//
// This file holds every enforcement site against the single table. It reads the real source, so
// changing the table without changing the code fails here, and changing the code without the table
// fails here too. That is the whole point: a pricing change should be loud.
function source(rel: string): string {
  return readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8')
}

// Each feature, and the code that actually enforces it. Every entry was read off the enforcement
// site rather than off the pricing page — where those disagree, the pricing page is what is wrong.
const ENFORCEMENT: Record<PaidFeature, { file: string; expect: (src: string, tier: string) => boolean; how: string }> = {
  bibSearch: {
    file: 'app/api/album/bib-search/route.ts', how: 'refuseBelowTier',
    expect: (s, t) => s.includes(`refuseBelowTier(access.album, '${t}'`),
  },
  faceFinder: {
    file: 'app/api/album/face-finder/route.ts', how: 'refuseBelowTier',
    expect: (s, t) => s.includes(`refuseBelowTier(access.album, '${t}'`),
  },
  sponsorLogos: {
    file: 'app/api/album/sponsors/route.ts', how: 'refuseBelowTier',
    expect: (s, t) => s.includes(`refuseBelowTier(access.album, '${t}'`),
  },
  albumLogo: {
    file: 'app/api/album/logo/route.ts', how: 'refuseBelowTier',
    expect: (s, t) => s.includes(`refuseBelowTier(access.album, '${t}'`),
  },
  photoModeration: {
    file: 'app/api/album/media-settings/route.ts', how: 'refuseBelowTier',
    expect: (s, t) => s.includes(`refuseBelowTier(access.album, '${t}'`),
  },
  countdownReveal: {
    file: 'app/api/album/reveal/route.ts', how: 'refuseBelowTier',
    expect: (s, t) => s.includes(`refuseBelowTier(access.album, '${t}'`),
  },
  // These two used to reject `tier === 'free'` read off the OWNER's account — which a package
  // never changes, so a paid Pro Package album kept 403ing both. Now the same package-aware call
  // as every other row.
  customUrl: {
    file: 'app/api/album/custom-url/route.ts', how: 'refuseBelowTier',
    expect: (s, t) => s.includes(`refuseBelowTier(access.album, '${t}'`),
  },
  hideBranding: {
    file: 'app/api/album/branding/route.ts', how: 'refuseBelowTier',
    expect: (s, t) => s.includes(`refuseBelowTier(access.album, '${t}'`),
  },
  collections: {
    file: 'app/c/[slug]/page.tsx', how: 'inline tier check on the public page',
    expect: (s, t) => s.includes(`tier !== '${t}'`),
  },
  liveWall: {
    file: 'app/wall/[slug]/page.tsx', how: 'albumHasTier',
    expect: (s, t) => s.includes(`'${t}'`) && s.includes('albumHasTier'),
  },
}

describe('every paid feature is enforced at the tier the table says', () => {
  for (const [feature, site] of Object.entries(ENFORCEMENT) as [PaidFeature, typeof ENFORCEMENT[PaidFeature]][]) {
    it(`${feature} — ${site.how} in ${site.file}`, () => {
      const tier = FEATURE_TIER[feature]
      expect(
        site.expect(source(site.file), tier),
        `${site.file} does not enforce '${tier}' for ${feature}. Either the code drifted from ` +
          `lib/plan-gates.ts, or the table was changed without changing the code. Both are the ` +
          `bug this test exists to make loud.`,
      ).toBe(true)
    })
  }

  it('covers every feature in the table — no silent omissions', () => {
    // A feature added to the table with no enforcement entry would be gated nowhere and tested
    // nowhere, which is the most expensive possible way to give something away.
    expect(Object.keys(ENFORCEMENT).sort()).toEqual(Object.keys(FEATURE_TIER).sort())
  })
})

describe('who is allowed what', () => {
  it('free gets none of it', () => {
    for (const f of Object.keys(FEATURE_TIER) as PaidFeature[]) {
      expect(tierAllows('free', f), `free must not get ${f}`).toBe(false)
    }
  })

  it('Max gets everything', () => {
    for (const f of Object.keys(FEATURE_TIER) as PaidFeature[]) {
      expect(tierAllows('studio', f), `Max must get ${f}`).toBe(true)
    }
  })

  it('Pro gets the pro features and none of the Max ones', () => {
    for (const f of Object.keys(FEATURE_TIER) as PaidFeature[]) {
      expect(tierAllows('pro', f)).toBe(FEATURE_TIER[f] === 'pro')
    }
  })
})

describe('an unknown tier is not a refusal', () => {
  it('allows nothing while the lookup is in flight', () => {
    expect(tierAllows(null, 'customUrl')).toBe(false)
    expect(tierIsKnown(null)).toBe(false)
  })

  it('but does NOT show a lock, which is the part people see', () => {
    // A PRO badge appearing on something the owner pays for and then vanishing is worse than a
    // control that is briefly plain and inert. The tier resolves in a few hundred milliseconds;
    // the contradiction is what they remember.
    expect(showsAsLocked(null, 'customUrl')).toBe(false)
    expect(showsAsLocked(undefined, 'faceFinder')).toBe(false)
  })

  it('locks once the tier is known and short', () => {
    expect(showsAsLocked('free', 'customUrl')).toBe(true)
    expect(showsAsLocked('pro', 'faceFinder')).toBe(true)
    expect(showsAsLocked('pro', 'customUrl')).toBe(false)
    expect(showsAsLocked('studio', 'faceFinder')).toBe(false)
  })
})

// THE FIFTH PLACE: the toolbar that draws the badges.
//
// The server refusing and the client showing an ordinary switch is the one-sided failure this whole
// file exists for — the owner does not find out until they have already tried. So the toolbar is
// held to the same table, and to asking about ITS OWN feature by name.
describe('the owner toolbar reads the same table as the server', () => {
  const toolbar = readFileSync(join(process.cwd(), 'src', 'components', 'OwnerToolbar.tsx'), 'utf8')

  it('asks plan-gates rather than comparing tiers by hand', () => {
    expect(toolbar.includes("from '@/lib/plan-gates'"), 'must import the shared table').toBe(true)
    // The hand-rolled comparisons this replaced. Either of them coming back means a control whose
    // tier can drift away from the server's without anything noticing.
    expect(/userTier === 'pro' \|\| userTier === 'studio'/.test(toolbar), 'inline pro-or-max test is back').toBe(false)
    expect(/const canUseCollections = userTier === 'studio'/.test(toolbar), 'inline studio test is back').toBe(false)
  })

  it('names a real feature at every gate', () => {
    // A typo'd or invented feature name would be a gate that silently allows everyone, since a
    // missing key makes tierAllows compare against undefined.
    const used = [...toolbar.matchAll(/(?:tierAllows|showsAsLocked)\(userTier, '([a-zA-Z]+)'\)/g)].map((m) => m[1])
    expect(used.length, 'the toolbar should be gating several controls').toBeGreaterThan(3)
    for (const name of used) {
      expect(Object.keys(FEATURE_TIER), `${name} is not a feature in the table`).toContain(name)
    }
  })

  it('gates each control on its own feature, not a shared bucket', () => {
    // EVERY feature the toolbar has a control for, not a hand-picked four. The first version of
    // this test listed four names and passed while Face Finder and bib search were both still
    // riding on the 'collections' flag — identical tier today, so nothing looked wrong, and
    // repackaging Face Finder as Pro would have left its switch Max-only in silence.
    for (const feature of ['customUrl', 'photoModeration', 'hideBranding', 'faceFinder', 'bibSearch']) {
      expect(toolbar.includes(`'${feature}'`), `${feature} must be gated by name`).toBe(true)
    }
  })

  it('gates COLLECTIONS on the account, because a package cannot grant it', () => {
    // The one feature that is not the album's to unlock: a collection groups albums across an
    // account, so a single-album package must not open it. The toolbar's `userTier` is the ALBUM's
    // plan (package included), so gating this row on the tier table showed an unlocked control on
    // every Max Package album and the collections API then 403'd it. It reads the account-level
    // answer the server sends instead.
    expect(toolbar, 'must use the account-scoped flag').toContain('album.collections_enabled === true')
    expect(
      /(?:tierAllows|showsAsLocked)\(userTier, 'collections'\)/.test(toolbar),
      'the album tier must not decide an account feature',
    ).toBe(false)
    // And the server must be the one computing it, from the OWNER's tier and not the album's.
    expect(source('lib/server/album-access.ts')).toContain("collections_enabled: ownerTier === 'studio'")
  })

  it('disables a gated control, not merely dims it', () => {
    // A row that is greyed and badged but still clickable teaches the owner nothing — they flip it
    // and learn it is paid from the error toast, which is the experience the badge replaced.
    // "Remove Hushare branding" was exactly that: styled by the plan, disabled only by the lock.
    const at = toolbar.indexOf('Remove Hushare branding')
    expect(at).toBeGreaterThan(-1)
    // 1,600 chars: the control sits ~1,000 after its label and the gap grows whenever the row
    // gains a comment. A window sized to today's layout is a test that breaks on formatting.
    const row = toolbar.slice(at, at + 1600)
    // Plain string, no regex: the first version built one with escapes and they were mangled before
    // the file reached disk, so it failed against correct code. Rule 24, for the third time today.
    expect(
      row.includes("disabled={album.branding_locked || !tierAllows(userTier, 'hideBranding')}"),
      'the branding toggle must be disabled by the plan as well as by the collaboration lock',
    ).toBe(true)
  })
})

// A FILTER ON AN UNSELECTED COLUMN IS A FILTER ON UNDEFINED.
//
// The admin page classifies subscription rows as house accounts partly by polar_product_id
// starting with "comp-" — and the query did not select that column. No error, no warning: the
// field was undefined, startsWith never matched, and a comped Max row sat in the Subscriptions
// table looking exactly like revenue while "Admins & comped" said None.
describe('the admin page selects what its filters read', () => {
  const page = readFileSync(join(process.cwd(), 'src', 'app', 'admin', 'page.tsx'), 'utf8')

  it('the subscriptions query includes polar_product_id', () => {
    const m = /from\('subscriptions'\)\.select\('([^']*user_id[^']*)'\)/.exec(page)
    expect(m, 'the row-level subscriptions select must exist').not.toBeNull()
    expect((m as RegExpExecArray)[1].includes('polar_product_id'),
      'isHouseAccount filters on polar_product_id — dropping it from the select turns comp rows into revenue, silently').toBe(true)
  })

  it('the house section is built from people, not only from subscription rows', () => {
    // An admin's Max comes from code, so an admin with no row must still appear.
    expect(page.includes('for (const u of allUsers)'), 'admins without rows must be listed').toBe(true)
    expect(page.includes("'admin · comped'"), 'an admin who also holds a comp row shows once, labelled with both').toBe(true)
  })
})

describe('the BILLED feature paths ask the ALBUM, never the owner account', () => {
  // A Max Package on a free account is the package's core buyer. Each of these three runs (or
  // refuses) the AWS work guests actually trigger, and each once asked the owner's subscription:
  // the search 403'd behind a working button, and both indexers returned 0 silently — bib search
  // "worked" and found nothing, rule 20's exact shape. getUserTierById is banned from these files;
  // the package can only be seen through albumHasTier.
  const BILLED = [
    'app/api/album/face-search/route.ts',
    'app/api/album/face-index/route.ts',
    'lib/server/bib-index.ts',
  ]
  for (const file of BILLED) {
    it(`${file}`, () => {
      const s = source(file)
      expect(s, 'must gate through the album-entitlement module').toContain('albumHasTier(')
      expect(s, 'owner-account tier reads are banned here').not.toContain('getUserTierById')
    })
  }
})
