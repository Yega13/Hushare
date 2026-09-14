import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { buildGraphFromDisk, rel, SRC, type Graph } from './helpers/import-graph'

// THE ONE BOUNDARY RULE.
//
//   No file reachable from a 'use client' module may transitively import
//   server-only, next/headers, @/lib/supabase/admin, @aws-sdk/*, or @opennextjs/cloudflare.
//
// That is the whole rule, and it is deliberately NARROWER than "src/lib imports nothing but
// src/lib". The wider version was proposed and rejected: it protects a property that is already
// intact, and buying it costs the failure MISTAKES.md entry 10 calls "the entry that matters" —
// forcing NextResponse refusals out of require-tier.ts and both upload-authorization modules and
// into twenty route handlers, which is exactly where the test coverage is not.
//
// `next/server` is NOT forbidden. NextResponse leaks nothing. The service-role key, the cookie
// store and the S3 credentials do, and those are the whole list.
//
// WHY A TEST AND NOT A LINT RULE. The dangerous case is TRANSITIVE: rate-limit.ts reaches the admin
// client in one hop, visitor-context.ts reaches @opennextjs/cloudflare from three call sites away.
// `no-restricted-imports` sees only direct imports, so a green lint would be a claim it is not
// entitled to make. There is no such rule in eslint.config.mjs today, and `npm run lint` does not
// run in CI at all — `npm test` does.
//
// WHY IT IS NOT REDUNDANT WITH `server-only`. That marker is real and does fail the build, but only
// three modules carry it. next/headers, @aws-sdk and @opennextjs/cloudflare have no marker, and a
// bundler error names a chunk rather than the import chain. This names the chain.
//
// The graph itself is built by tests/helpers/import-graph, shared with tests/marketing-bundle.

const FORBIDDEN_FROM_BROWSER = [
  'server-only',
  'next/headers',
  '@/lib/supabase/admin',
  '@aws-sdk/',
  '@opennextjs/cloudflare',
]

const isForbidden = (spec: string) =>
  FORBIDDEN_FROM_BROWSER.some((f) => (f.endsWith('/') ? spec.startsWith(f) : spec === f))

/**
 * Every server-only specifier reachable from a client entry, with the chain that gets there.
 *
 * Exported shape so the literal-input tests below can drive it without touching the disk: a graph
 * built from the repo can drift, a graph written in the test cannot.
 */
export function violations(g: Graph): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (file: string, trail: string[]) => {
    // Cycle guard. Two modules importing each other is legal and common; without this the walk
    // never returns and the suite hangs rather than failing.
    if (seen.has(file)) return
    seen.add(file)
    for (const spec of g.external.get(file) ?? []) {
      // Repo-relative, because an absolute Windows path per hop makes a four-hop chain unreadable
      // and the chain is the entire value of this message over a bundler error.
      if (isForbidden(spec)) {
        const chain = [...trail, file].map(rel).join(' -> ')
        out.push(`${chain}  imports  ${spec}`)
      }
    }
    for (const dep of g.local.get(file) ?? []) visit(dep, [...trail, file])
  }
  for (const entry of g.clientEntries) visit(entry, [])
  return out.sort()
}

// ── The checker's own correctness, on inputs that cannot drift ────────────────────────────────

const g = (
  localPairs: [string, string[]][],
  externalPairs: [string, string[]][],
  entries: string[],
): Graph => ({
  local: new Map(localPairs.map(([k, v]) => [k, new Set(v)])),
  external: new Map(externalPairs.map(([k, v]) => [k, new Set(v)])),
  clientEntries: new Set(entries),
})

describe('the checker can actually see a violation', () => {
  it('catches a DIRECT import', () => {
    expect(violations(g([['c.tsx', []]], [['c.tsx', ['server-only']]], ['c.tsx']))).toHaveLength(1)
  })

  it('catches a THREE-HOP import — the case a lint rule cannot see', () => {
    // This assertion is the reason this file exists rather than a no-restricted-imports entry.
    const found = violations(g(
      [['c.tsx', ['a.ts']], ['a.ts', ['b.ts']], ['b.ts', ['d.ts']], ['d.ts', []]],
      [['d.ts', ['@/lib/supabase/admin']]],
      ['c.tsx'],
    ))
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('c.tsx -> a.ts -> b.ts -> d.ts')
  })

  it('does NOT flag a server file that no client entry reaches', () => {
    // The rule is about REACHABILITY, not about the import existing. Getting this wrong makes every
    // route handler a violation, and a rule that fires on correct code gets switched off within a
    // day (rule 12b).
    expect(violations(g([['r.ts', []]], [['r.ts', ['next/headers']]], []))).toEqual([])
  })

  it('terminates on an import CYCLE instead of hanging', () => {
    expect(violations(g([['a.ts', ['b.ts']], ['b.ts', ['a.ts']]], [['b.ts', ['server-only']]], ['a.ts'])))
      .toHaveLength(1)
  })

  it('does not flag next/server — the exemption is asserted, not assumed', () => {
    // If someone "tightens" this rule by adding next/server, THIS test tells them the exemption was
    // a decision and sends them to MISTAKES entry 10, rather than to a merge conflict.
    expect(violations(g([['c.tsx', []]], [['c.tsx', ['next/server']]], ['c.tsx']))).toEqual([])
  })

  it('matches @aws-sdk by prefix, not by exact name', () => {
    expect(violations(g([['c.tsx', []]], [['c.tsx', ['@aws-sdk/client-s3']]], ['c.tsx']))).toHaveLength(1)
  })
})

// ── The real repo ─────────────────────────────────────────────────────────────────────────────

describe('the walk sees the real repo', () => {
  const real = buildGraphFromDisk()

  it('found a real graph, not an empty one', () => {
    // A scan that silently matched nothing reports "all clear" from a blind spot, which is worse
    // than no rule at all. tests/architecture.test.ts's walk failed exactly this way twice.
    expect(real.clientEntries.size, "no 'use client' files found — the scan is broken").toBeGreaterThan(50)
    expect(real.local.size, 'no files walked').toBeGreaterThan(300)
    const externalCount = [...real.external.values()].reduce((n, s) => n + s.size, 0)
    expect(externalCount, 'no package imports parsed — the import regex is broken').toBeGreaterThan(200)
  })

  it('resolves @/ aliases, relative paths and directory index files', () => {
    const albumAccess = join(SRC, 'lib', 'server', 'album-access.ts')
    expect(real.local.has(albumAccess)).toBe(true)
    expect([...(real.local.get(albumAccess) ?? [])].length, 'album-access resolves no local imports')
      .toBeGreaterThan(3)
  })

  it('sees the admin client as reachable from at least one SERVER file', () => {
    // Proves the forbidden specifier is actually present in the graph. Without this, "zero
    // violations" could mean "the specifier is never seen", which is the blind-spot failure again.
    const reachesAdmin = [...real.external.entries()]
      .filter(([, specs]) => [...specs].some(isForbidden))
    expect(reachesAdmin.length, 'no file imports any forbidden specifier — the parse is wrong')
      .toBeGreaterThan(5)
  })

  it('has NO server-only specifier reachable from a browser entry', () => {
    const found = violations(real)
    expect(found, 'each line is the exact chain from a client component to a credential').toEqual([])
  })
})
