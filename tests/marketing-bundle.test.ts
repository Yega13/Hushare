import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildGraphFromDisk, rel, SRC, type Graph } from './helpers/import-graph'

// THE PAGES A VISITOR MEETS FIRST SHIP NO SUPABASE CLIENT.
//
// The review of 2026-09-14 measured supabase-js at 221 KB in the home page's JavaScript, pulled in by
// two components that each wanted one answer: the nav link (to hear a sign-in in another tab) and the
// device-albums list (to read a session cookie). Both now get it without the library
// (lib/auth-tab-sync, lib/use-account-identity). Pages that genuinely need a client -- an album, the
// login form, the account page -- still load it; this pins the pages that do not.
//
// Server components may import the SERVER Supabase client freely: that never reaches a browser. What
// is checked is everything reachable once the walk crosses a 'use client' file, which is exactly what
// the bundler ships to the visitor.

const BROWSER_CLIENT_FILE = join(SRC, 'lib', 'supabase', 'client.ts')
const isSupabasePackage = (spec: string) => spec === '@supabase/ssr' || spec === '@supabase/supabase-js'

/** Every way a browser-side Supabase client is reachable from this entry, as import chains. */
export function supabaseInBrowser(g: Graph, entry: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (file: string, trail: string[], inBrowser: boolean) => {
    const browser = inBrowser || g.clientEntries.has(file)
    const key = `${file}|${browser}`
    if (seen.has(key)) return
    seen.add(key)
    const chain = () => [...trail, file].map(rel).join(' -> ')
    if (browser) {
      if (file === BROWSER_CLIENT_FILE) out.push(chain())
      for (const spec of g.external.get(file) ?? []) if (isSupabasePackage(spec)) out.push(`${chain()}  imports  ${spec}`)
    }
    for (const dep of g.local.get(file) ?? []) visit(dep, [...trail, file], browser)
  }
  visit(entry, [], false)
  return out.sort()
}

// ── the checker, on graphs that cannot drift ───────────────────────────────────────────────────

const g = (local: [string, string[]][], external: [string, string[]][], clients: string[]): Graph => ({
  local: new Map(local.map(([k, v]) => [k, new Set(v)])),
  external: new Map(external.map(([k, v]) => [k, new Set(v)])),
  clientEntries: new Set(clients),
})

describe('the checker', () => {
  it('finds the client two hops below a client component', () => {
    const found = supabaseInBrowser(g([['page.tsx', ['Nav.tsx']], ['Nav.tsx', ['hook.ts']], ['hook.ts', [BROWSER_CLIENT_FILE]]], [], ['Nav.tsx']), 'page.tsx')
    expect(found).toHaveLength(1)
  })

  it('finds a package import once inside the browser part', () => {
    expect(supabaseInBrowser(g([['page.tsx', ['Nav.tsx']]], [['Nav.tsx', ['@supabase/ssr']]], ['Nav.tsx']), 'page.tsx')).toHaveLength(1)
  })

  it('does NOT flag a server page using Supabase on the server', () => {
    expect(supabaseInBrowser(g([['page.tsx', []]], [['page.tsx', ['@supabase/ssr']]], []), 'page.tsx')).toEqual([])
  })

  it('terminates on a cycle', () => {
    expect(supabaseInBrowser(g([['a.tsx', ['b.ts']], ['b.ts', ['a.tsx']]], [], ['a.tsx']), 'a.tsx')).toEqual([])
  })
})

// ── the real pages ─────────────────────────────────────────────────────────────────────────────

const MARKETING_ENTRIES = [
  'app/layout.tsx', // wraps every page, so its client components ship everywhere
  'app/page.tsx',
  'app/pricing/page.tsx',
  'app/about/page.tsx',
  'app/terms/page.tsx',
  'app/privacy/page.tsx',
  'app/support/page.tsx',
  'app/report/page.tsx',
  'app/collabs/page.tsx',
  'components/SeoLandingPage.tsx',
].map((p) => join(SRC, ...p.split('/')))

describe('marketing pages ship no Supabase client', () => {
  const real = buildGraphFromDisk()

  it('every page named here exists, so a rename cannot turn this into a check of nothing', () => {
    for (const entry of MARKETING_ENTRIES) expect(existsSync(entry), rel(entry)).toBe(true)
  })

  it('THE WALK CAN SEE ONE: the album page does load the client, and this finds it', () => {
    expect(supabaseInBrowser(real, join(SRC, 'app', '[slug]', 'page.tsx')).length).toBeGreaterThan(0)
  })

  for (const entry of MARKETING_ENTRIES) {
    it(`${rel(entry)} reaches no browser Supabase client`, () => {
      expect(supabaseInBrowser(real, entry), 'each line is the import chain that ships it').toEqual([])
    })
  }
})
