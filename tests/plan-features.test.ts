import { describe, it, expect } from 'vitest'
import { MAX_IMG_DIM } from '@/lib/upload-policy'
import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { planFeatures } from '@/lib/plan-features'
import { en } from '@/i18n/dictionaries/en'
import { ru } from '@/i18n/dictionaries/ru'
import { hy } from '@/i18n/dictionaries/hy'
import {
  albumCountLimitForTier,
  albumMediaCapForTier,
  uploadCapsForTier,
  formatCapSize,
} from '@/lib/media'

// What a plan CLAIMS to include has to match what the server actually gates, and these lists are
// read by someone at the moment they hand over money — the worst possible place to overstate.
//
// The hand-written lists this replaced advertised "Max Collections" on the Pro card (Collections
// are studio-only) and "Password protection" on both paid cards (free albums have always had it),
// while the free card quoted a 250-item cap the server had long stopped using. Every one of those
// is a promise that could not be kept or a giveaway of something already free, and none of it was
// caught because nothing tied the copy to the code.

const keys = (tier: Parameters<typeof planFeatures>[0], isAdmin = false) =>
  planFeatures(tier, isAdmin).map((f) => f.key)

describe('plan features describe what is actually gated', () => {
  it('never sells a free feature as a paid one', () => {
    // These are not gated anywhere on the server, so no paid plan may take credit for them.
    // plan.photoWall USED TO BE ON THIS LIST and is deliberately not any more: app/wall/[slug] now
    // requires Max. Anything added here must be checked against GATED_ROUTES below, not assumed.
    const freeForEveryone = ['plan.password', 'plan.qr']
    for (const tier of ['pro', 'studio'] as const) {
      for (const k of freeForEveryone) {
        expect(keys(tier), `${tier} must not advertise ${k}`).not.toContain(k)
      }
    }
  })

  it('keeps studio-only features off the Pro card', () => {
    // app/c/[slug] and api/album/face-* both require tier === 'studio'.
    expect(keys('pro')).not.toContain('plan.collections')
    expect(keys('pro')).not.toContain('plan.faceFinder')
    expect(keys('studio')).toContain('plan.collections')
    expect(keys('studio')).toContain('plan.faceFinder')
  })

  it('only names paid perks the server enforces', () => {
    // api/album/custom-url and api/album/branding both reject tier === 'free'.
    expect(keys('pro')).toContain('plan.customUrl')
    expect(keys('pro')).toContain('plan.noBranding')
    expect(keys('free')).not.toContain('plan.customUrl')
    expect(keys('free')).not.toContain('plan.noBranding')
  })

  it('quotes the limits the server enforces, not copied numbers', () => {
    for (const tier of ['free', 'pro', 'studio'] as const) {
      const features = planFeatures(tier)
      const albums = features.find((f) => f.key === 'plan.albums')
      const perAlbum = features.find((f) => f.key === 'plan.perAlbum')
      const uploads = features.find((f) => f.key === 'plan.uploads')
      expect(albums?.vars?.n).toBe(albumCountLimitForTier(tier))
      expect(perAlbum?.vars?.n).toBe(albumMediaCapForTier(tier))
      expect(uploads?.vars?.photo).toBe(formatCapSize(uploadCapsForTier(tier).image))
      expect(uploads?.vars?.video).toBe(formatCapSize(uploadCapsForTier(tier).video))
    }
  })

  it('gives every tier a higher allowance than the one below', () => {
    const cap = (t: Parameters<typeof planFeatures>[0]) => albumMediaCapForTier(t)
    expect(cap('pro')).toBeGreaterThan(cap('free'))
    expect(cap('studio')).toBeGreaterThan(cap('pro'))
    expect(albumCountLimitForTier('pro')).toBeGreaterThan(albumCountLimitForTier('free'))
    expect(albumCountLimitForTier('studio')).toBeGreaterThan(albumCountLimitForTier('pro'))
    expect(uploadCapsForTier('studio').video).toBeGreaterThan(uploadCapsForTier('pro').video)
    expect(uploadCapsForTier('pro').video).toBeGreaterThan(uploadCapsForTier('free').video)
  })

  it('has a string for every key it emits, in every language', () => {
    const all = new Set<string>()
    for (const tier of ['free', 'pro', 'studio'] as const) keys(tier).forEach((k) => all.add(k))
    keys('studio', true).forEach((k) => all.add(k))

    for (const k of all) {
      // English is the source dictionary and MUST have every key — ru/hy fall back to it, so a
      // missing translation degrades to English rather than showing a raw key like "plan.albums".
      expect(en, `en is missing ${k}`).toHaveProperty(k)
      for (const [name, dict] of [['ru', ru], ['hy', hy]] as const) {
        const value = (dict as Record<string, string>)[k]
        if (value === undefined) continue
        // A translation that drops a placeholder would silently print nothing where a number
        // belongs — worse than being untranslated.
        const placeholders = [...String(en[k as keyof typeof en]).matchAll(/\{(\w+)\}/g)].map((m) => m[1])
        for (const ph of placeholders) {
          expect(value, `${name}.${k} lost the {${ph}} placeholder`).toContain(`{${ph}}`)
        }
      }
    }
  })

  it('has no gaps in the pricing feature keys', () => {
    // The pricing page renders features BY POSITION — `tt(\`pricing.\${tier}.f\${i + 1}\`)` — so a
    // key that is missing from the middle of the run renders the literal string "pricing.pro.f7" on
    // a public page. Nothing throws; it just says that to a customer. A gap is the only way to get
    // there, so a gap is what this checks.
    for (const [name, dict] of [['en', en], ['ru', ru], ['hy', hy]] as const) {
      // A LITERAL regex, not one built from a template string. The first version of this test used
      // new RegExp(`^pricing\.${tier}\.f(\d+)$`) — inside a template literal `\d` collapses to a
      // plain "d", so the pattern matched nothing, every tier hit the `continue` below, and the test
      // passed while checking absolutely nothing. A test that cannot fail is worse than no test,
      // because it is counted as coverage.
      const KEY = /^pricing\.(free|pro|max)\.f(\d+)$/
      for (const tier of ['free', 'pro', 'max']) {
        const nums = Object.keys(dict)
          .map((k) => KEY.exec(k))
          .filter((m): m is RegExpExecArray => m !== null && m[1] === tier)
          .map((m) => Number(m[2]))
          .sort((a, b) => a - b)
        if (nums.length === 0) continue // ru/hy only override some keys; English is the source
        expect(nums[0], `${name}.${tier} should start at f1`).toBe(1)
        for (let i = 0; i < nums.length; i++) {
          expect(nums[i], `${name}.${tier} has a gap before f${nums[i]}`).toBe(i + 1)
        }
      }
    }
  })
})

describe('the pricing FAQ has a question and an answer for every number it counts', () => {
  // src/app/pricing/page.tsx counts the q keys and then indexes BOTH q and a by that count — once
  // for the visible list, once for the FAQPage structured data. A missing or out-of-order answer
  // would put `undefined` into the JSON-LD that search engines read, silently. The two used to be
  // separate hand-typed lists and drifted; deriving them from one source moved the risk here.
  // A LITERAL regex, matching both prefixes at once. Built from a template string it would have
  // been `\d` inside a template literal, which collapses to a plain "d" and matches nothing — the
  // exact trap documented further down this file, and the first draft of this test walked straight
  // into it. The `toBeGreaterThan(0)` below is what caught it, which is why that line is there.
  const KEY = /^pricing\.faq\.(q|a)(\d+)$/
  const num = (prefix: 'q' | 'a') =>
    Object.keys(en)
      .map((k) => KEY.exec(k))
      .filter((m): m is RegExpExecArray => m !== null && m[1] === prefix)
      .map((m) => Number(m[2]))
      .sort((a, b) => a - b)

  it('numbers questions and answers 1..n with no gaps', () => {
    const qs = num('q')
    const as = num('a')
    expect(qs.length, 'no pricing.faq.q keys found').toBeGreaterThan(0)
    expect(as, 'every question needs an answer with the same number').toEqual(qs)
    qs.forEach((n, i) => expect(n, `gap before pricing.faq.q${n}`).toBe(i + 1))
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The lists above are only honest while they track the gates the SERVER enforces, and the gates
// move. The live photo wall was ungated when planFeatures was written, so it was listed as a free
// feature; app/wall/[slug] later started requiring Max and nothing here noticed. The free plan then
// spent that whole time promising, on the account page, a page the product refuses to open.
//
// So this does not check a copied list against another copied list. It READS THE ROUTES, finds
// every tier gate in them, and fails if a gate exists that this file has never been told about.
// Adding a gate now forces a decision: which plan advertises it, or explicitly nothing.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// Every way a gate is currently written. Two idioms exist — the refuseBelowTier/albumHasTier
// helpers, and hand-rolled comparisons that predate them — and both must be found, because a gate
// that this regex misses is a gate the test cannot protect.
const GATE_PATTERNS = [
  /refuseBelowTier\([^)]*?['"](pro|studio)['"]/g,
  /albumHasTier\([^)]*?['"](pro|studio)['"]/g,
  /tier\s*===\s*['"]free['"]/g,
  /tier\s*!==\s*['"]studio['"]/g,
  /\)\)\s*!==\s*['"]studio['"]/g,
  /\)\)\s*===\s*['"]studio['"]/g,
]

// route file (posix, relative to src/app) → the plan-feature key that sells it, or null when the
// gate is deliberately not a bullet on any plan card.
const GATED_ROUTES: Record<string, string | null> = {
  'api/album/logo/route.ts': 'plan.logo',
  'api/album/media-settings/route.ts': 'plan.moderation',
  'api/album/reveal/route.ts': 'plan.reveal',
  'api/album/custom-url/route.ts': 'plan.customUrl',
  'api/album/branding/route.ts': 'plan.noBranding',
  'api/album/sponsors/route.ts': 'plan.sponsors',
  'api/album/bib-search/route.ts': 'plan.bibSearch',
  'api/album/face-finder/route.ts': 'plan.faceFinder',
  'api/album/face-search/route.ts': 'plan.faceFinder',
  'api/album/face-index/route.ts': 'plan.faceFinder',
  'wall/[slug]/page.tsx': 'plan.photoWall',
  'c/[slug]/page.tsx': 'plan.collections',
}

// Which plan each key belongs to, so "listed on the right card" is checkable rather than assumed.
const SOLD_BY: Record<string, 'pro' | 'studio'> = {
  'plan.logo': 'pro',
  'plan.moderation': 'pro',
  'plan.reveal': 'pro',
  'plan.customUrl': 'pro',
  'plan.noBranding': 'pro',
  'plan.sponsors': 'studio',
  'plan.bibSearch': 'studio',
  'plan.faceFinder': 'studio',
  'plan.photoWall': 'studio',
  'plan.collections': 'studio',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('the plan lists track the gates the server actually enforces', () => {
  const appDir = join(process.cwd(), 'src', 'app')
  const gatedFiles = walk(appDir)
    .filter((f) => GATE_PATTERNS.some((re) => { re.lastIndex = 0; return re.test(readFileSync(f, 'utf8')) }))
    .map((f) => f.slice(appDir.length + 1).split(sep).join('/'))

  it('finds the gates at all', () => {
    // A guard on the guard: if the patterns ever stop matching, every assertion below would pass
    // vacuously while checking nothing — the same way the pricing-key regex once did.
    expect(gatedFiles.length).toBeGreaterThanOrEqual(10)
  })

  it('knows about every gated route in src/app', () => {
    const unknown = gatedFiles.filter((f) => !(f in GATED_ROUTES))
    expect(
      unknown,
      `New tier gate(s) with no decision recorded. Add each to GATED_ROUTES in this file — map it ` +
        `to the plan-feature key that sells it, or to null if no plan card mentions it.`,
    ).toEqual([])
  })

  it('lists every gated feature on the plan that unlocks it, and no lower one', () => {
    for (const [route, key] of Object.entries(GATED_ROUTES)) {
      if (key === null) continue
      const tier = SOLD_BY[key]
      expect(tier, `${key} (${route}) has no entry in SOLD_BY`).toBeDefined()
      expect(keys(tier), `${tier} must advertise ${key} — ${route} gates it`).toContain(key)
      expect(keys('free'), `free must not advertise ${key} — ${route} gates it`).not.toContain(key)
      if (tier === 'studio') {
        expect(keys('pro'), `pro must not advertise ${key} — ${route} is Max-only`).not.toContain(key)
      }
    }
  })
})

// WHAT THE HOMEPAGE PROMISES ABOUT UPLOAD LIMITS IS WHAT THE SERVER ENFORCES.
//
// The limits used to be typed into each translation by hand. English was corrected from 50 MB to
// 200 MB when the free video cap was raised; Russian and Armenian kept the old number. So for
// months those visitors read that free video was capped at 50 MB — a quarter of the truth, and
// below an ordinary phone clip — on the page where someone decides whether to bother at all. The
// cap had been raised precisely because that number was turning people away.
//
// The answer takes placeholders now and the page fills them from uploadCapsForTier. This asserts
// the placeholders survive: a translator "helpfully" writing a number back in restores the bug.
describe('the homepage FAQ cannot state a stale upload limit', () => {
  const PLACEHOLDERS = ['{freePhoto}', '{freeVideo}', '{proPhoto}', '{proVideo}', '{maxVideo}']

  for (const locale of ['en', 'ru', 'hy']) {
    it(`${locale} states the caps as placeholders, not numbers`, () => {
      const src = readFileSync(join(process.cwd(), 'src', 'i18n', 'dictionaries', `${locale}.ts`), 'utf8')
      const line = /^ {2}'home\.faq\.a10': '(.*?)',$/m.exec(src)
      expect(line, `${locale} is missing home.faq.a10`).not.toBeNull()
      const answer = (line as RegExpExecArray)[1]
      for (const p of PLACEHOLDERS) {
        expect(answer.includes(p), `${locale} lost the ${p} placeholder — a hardcoded number is back`).toBe(true)
      }
      // Any size written as a literal is a number that will go stale. Unit words differ per
      // language, so this looks for a digit followed by any of them.
      const literals = answer.match(/\d+\s*(?:MB|GB|МБ|ГБ|ՄԲ|ԳԲ)/g) ?? []
      expect(literals, `${locale} has hardcoded sizes again`).toEqual([])
    })
  }

  it('the page fills them from the caps the server enforces', () => {
    const page = readFileSync(join(process.cwd(), 'src', 'app', 'page.tsx'), 'utf8')
    expect(page.includes('uploadCapsForTier'), 'the homepage must read the real caps').toBe(true)
    expect(page.includes('interpolate('), 'and interpolate them into the answer').toBe(true)
  })

  it('renders every FAQ entry rather than a hardcoded ten', () => {
    // A literal count means adding home.faq.q11 renders nothing and reports nothing.
    const page = readFileSync(join(process.cwd(), 'src', 'app', 'page.tsx'), 'utf8')
    expect(/Array\.from\(\{ length: 10 \}/.test(page), 'the FAQ length must be derived from the dictionary').toBe(false)
  })
})

// A RAW {token} MUST NEVER REACH A VISITOR.
//
// interpolate returns the string untouched when no vars are passed, so a key containing {n} called
// without them renders "{n}" on screen. Found in FaceFinder: the placeholder was being handed to
// the headline (which has none) while the hint (which has one) was called bare. Near-unreachable
// today, because face-search only returns ids it also returns rows for — but a guard path that is
// broken the day it fires is not a guard.
describe('every interpolated string is called with the vars it needs', () => {
  const dict = readFileSync(join(process.cwd(), 'src', 'i18n', 'dictionaries', 'en.ts'), 'utf8')

  /** Keys whose English text contains a {placeholder}. */
  const keysWithTokens = new Set<string>()
  for (const raw of dict.split(String.fromCharCode(10))) {
    // .trim() first: the file has CRLF endings, so an anchored match would look for the comma at
    // the end of a line that actually ends in a carriage return, and find nothing at all.
    const m = /^'([a-zA-Z0-9._]+)':\s*'(.*)',$/.exec(raw.trim())
    if (m && m[2].includes('{')) keysWithTokens.add(m[1])
  }

  it('found keys that take placeholders', () => {
    expect(keysWithTokens.size, 'a guard on the guard — an empty set proves nothing').toBeGreaterThan(5)
  })

  for (const file of ['components/FaceFinder.tsx', 'components/BibSearchBar.tsx']) {
    it(`${file} passes vars wherever the string expects them`, () => {
      const src = readFileSync(join(process.cwd(), 'src', ...file.split('/')), 'utf8')
      const offenders: string[] = []
      // t('some.key') with no second argument.
      for (const m of src.matchAll(/\bt\('([a-zA-Z0-9._]+)'\s*\)/g)) {
        if (keysWithTokens.has(m[1])) offenders.push(m[1])
      }
      expect(
        offenders,
        `these strings contain a {placeholder} but are called with no vars, so the visitor sees ` +
          `the raw token`,
      ).toEqual([])
    })
  }
})

// THE QUALITY PROMISE MATCHES THE PIXELS THE CODE KEEPS.
//
// The About page and four landing pages described a 2560px resize for months after the limit moved
// to 3500px — underselling the product on the exact pages that argue for it. Worse, the Russian and
// Armenian About copy promised "no compression whatsoever", which the code has never done for
// photos over the limit. A promise a photographer can falsify with one exiftool call, on the trust
// page.
//
// Pinned to MAX_IMG_DIM itself: raise the limit and every one of these fails until the copy
// follows, which is precisely the drift that already happened once.
describe('the copy describes the real resize limit', () => {
  const COPY_FILES = [
    'i18n/dictionaries/en.ts', 'i18n/dictionaries/ru.ts', 'i18n/dictionaries/hy.ts',
    'app/event-photo-sharing/page.tsx', 'app/qr-code-photo-album/page.tsx',
    'app/shared-photo-album/page.tsx', 'app/wedding-photo-sharing/page.tsx',
  ]

  for (const rel of COPY_FILES) {
    it(`${rel} states ${MAX_IMG_DIM}px and nothing stale`, () => {
      const src = readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8')
      expect(src.includes(`${MAX_IMG_DIM}px`), `must describe the real ${MAX_IMG_DIM}px limit`).toBe(true)
      expect(src.includes('2560px'), 'the stale 2560px claim is back').toBe(false)
    })
  }
})

// THE SEARCH-ENGINE FAQ IS THE PAGE'S FAQ.
//
// layout.tsx served a hand-typed FAQPage JSON-LD that had already drifted twice: two questions the
// homepage renders were missing entirely, and the retention answer was quietly reworded. Search
// engines got the older, shorter copy. pricing/page.tsx fixed this same defect for itself months
// ago; the layout never adopted it.
describe('the JSON-LD FAQ cannot drift from the homepage FAQ', () => {
  const layout = readFileSync(join(process.cwd(), 'src', 'app', 'layout.tsx'), 'utf8')

  it('builds from the dictionary, not from hand-typed entries', () => {
    expect(layout.includes('homeFaqJsonLd'), 'must build the FAQ from the dictionary').toBe(true)
    expect(layout.includes('HOME_FAQ_COUNT'), 'and derive the count, not hardcode it').toBe(true)
    // The shape of the old hand-typed block: a Question literal with a name string inline. One
    // remaining means somebody re-added a manual entry beside the generated ones.
    const manual = layout.match(/"@type": "Question",\s*\n\s*name: "/g) ?? []
    expect(manual, 'no hand-typed Question entries may remain').toEqual([])
  })

  it('interpolates the upload caps so the emitted answer has no raw {token}', () => {
    expect(layout.includes('interpolate('), 'the a10 placeholders must be filled').toBe(true)
    expect(layout.includes('uploadCapsForTier('), 'from the caps the server enforces').toBe(true)
  })
})

// THE SUPPORT BOT'S NUMBERS COME FROM THE CODE THAT ENFORCES THEM.
//
// The system prompt answers people deciding whether to pay, and its numbers were hand-typed — an
// audit found six wrong at once (free video 50 MB vs the real 200, item counts, features on the
// wrong plans). It is a template literal in a Node route, so there was never a reason for
// literals. This guards against one being "helpfully" typed back in.
describe('the support prompt interpolates its limits', () => {
  const route = readFileSync(join(process.cwd(), 'src', 'app', 'api', 'support', 'chat', 'route.ts'), 'utf8')

  it('reads caps and counts from lib/media', () => {
    for (const marker of ['uploadCapsForTier(', 'formatCapSize(', '${ANON_ALBUM_LIMIT}', '${n(STUDIO_ALBUM_MEDIA)}']) {
      expect(route.includes(marker), `${marker} must feed the prompt`).toBe(true)
    }
  })

  it('has no hand-typed plan numbers left', () => {
    for (const stale of ['up to 250 items', 'up to 500 items', 'up to 3,000 items', 'up to 10,000 items', 'up to 25 MB', 'up to 200 MB']) {
      expect(route.includes(stale), `"${stale}" is a literal again — it will drift`).toBe(false)
    }
  })
})
