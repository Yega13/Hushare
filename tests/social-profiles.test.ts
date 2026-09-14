import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  SOCIAL_HANDLE, SOCIAL_PROFILES, socialHandleLabel, socialProfile, socialProfileUrls,
} from '@/lib/social-profiles'

// ONE HANDLE, WRITTEN ONCE.
//
// It was typed out three times -- twice on /about, once in the structured data for Google -- and
// the copies had already drifted (a trailing slash on one, not the other). The footer would have
// been the fourth. The failure this prevents is silent by nature: rename the account, miss a copy,
// and that one surface links a profile that no longer exists while every other surface looks right.

const SRC_DIR = join(process.cwd(), 'src')
const HOME = join(SRC_DIR, 'lib', 'social-profiles.ts')
const read = (...parts: string[]) => readFileSync(join(SRC_DIR, ...parts), 'utf8')

// Every text format a person could hand-type a link into. It read only code and CSS at first, which
// covered every file src holds today -- and would have waved through the first JSON or Markdown file
// that ever spelled the handle out. Images and icons are skipped: nobody follows a handle in a PNG.
const TEXT_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|md|mdx|html|txt|xml|webmanifest)$/

function sourceFiles(): string[] {
  return readdirSync(SRC_DIR, { recursive: true, encoding: 'utf8' })
    .filter((f) => TEXT_FILE.test(f))
    .map((f) => join(SRC_DIR, f))
}

// WRITTEN OUT HERE, NOT READ FROM THE MODULE. An expectation built from the module under test agrees
// with that module whatever it says: swapping the two networks' names passed every assertion that
// compared against p.name, because both sides read the same wrong value. A review found that; these
// are the independent answers.
const EXPECTED = {
  instagram: { name: 'Instagram', url: `https://www.instagram.com/${SOCIAL_HANDLE}/` },
  tiktok: { name: 'TikTok', url: `https://www.tiktok.com/@${SOCIAL_HANDLE}` },
} as const

describe('the profiles', () => {
  it('link each network to its own site, over https, under our handle', () => {
    for (const p of SOCIAL_PROFILES) expect(p.url, p.network).toBe(EXPECTED[p.network].url)
  })

  it('name each network by its own name, which is what a screen reader announces', () => {
    for (const p of SOCIAL_PROFILES) expect(p.name, p.network).toBe(EXPECTED[p.network].name)
  })

  it('lists each network exactly once, and every network the type names', () => {
    expect(SOCIAL_PROFILES.map((p) => p.network)).toEqual(['instagram', 'tiktok'])
  })

  it('answers a lookup with the same profile the list holds', () => {
    for (const p of SOCIAL_PROFILES) expect(socialProfile(p.network)).toBe(p)
  })

  it('writes the handle the way people write it', () => {
    const label = socialHandleLabel()
    expect(label.startsWith('@')).toBe(true)
    expect(label.slice(1)).toBe(SOCIAL_HANDLE)
  })

  it('declares both accounts to search engines', () => {
    expect(socialProfileUrls()).toEqual([EXPECTED.instagram.url, EXPECTED.tiktok.url])
  })

  it('cannot be edited at runtime by whatever imports it', () => {
    // Every marketing page imports this. One mutation anywhere would change every surface at once.
    expect(Object.isFrozen(SOCIAL_PROFILES)).toBe(true)
    for (const p of SOCIAL_PROFILES) expect(Object.isFrozen(p), p.network).toBe(true)
  })
})

describe('the handle is spelled out in one file only', () => {
  const files = sourceFiles()

  it('the walk actually sees the source tree, including the one file allowed to hold it', () => {
    // Without this, a walk that found nothing would pass the check below by having nothing to check.
    expect(files.length).toBeGreaterThan(200)
    expect(files).toContain(HOME)
    expect(readFileSync(HOME, 'utf8')).toContain(SOCIAL_HANDLE)
  })

  it('no other file under src contains it', () => {
    // Case-insensitive, so "@Hushare_Space" typed into a caption is caught. The cost is a false alarm
    // on an unrelated identifier that happens to contain the same letters; none exists, and a false
    // alarm is a rename away, where a missed copy is a broken link nobody reports.
    const offenders = files
      .filter((f) => f !== HOME)
      .filter((f) => readFileSync(f, 'utf8').toLowerCase().includes(SOCIAL_HANDLE))
      .map((f) => relative(SRC_DIR, f))
    expect(offenders, 'import SOCIAL_PROFILES / socialHandleLabel from lib/social-profiles instead').toEqual([])
  })
})

describe('every surface reads the one definition', () => {
  it('the structured data declares the WHOLE list', () => {
    // Exact, comma included: anything narrowing the list between the call and the comma -- a
    // .slice(0, 1) that quietly drops TikTok from Google's picture of the brand -- fails this.
    // The root layout is a server module with no export to call, so its source is the thing to read.
    expect(read('app', 'layout.tsx')).toContain('sameAs: socialProfileUrls(),')
  })

  it('/about links its inline mention from the definition', () => {
    expect(read('app', 'about', 'page.tsx')).toContain("socialProfile('instagram').url")
  })

  it('/about draws its buttons with the component tests/social-buttons renders', () => {
    expect(read('app', 'about', 'page.tsx')).toContain('<SocialButtons />')
  })

  it('the site footer carries the prints', () => {
    expect(read('components', 'SiteFooter.tsx')).toContain('<FooterSocials')
  })
})
