import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

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

const SRC = join(process.cwd(), 'src')

const FORBIDDEN_FROM_BROWSER = [
  'server-only',
  'next/headers',
  '@/lib/supabase/admin',
  '@aws-sdk/',
  '@opennextjs/cloudflare',
]

const isForbidden = (spec: string) =>
  FORBIDDEN_FROM_BROWSER.some((f) => (f.endsWith('/') ? spec.startsWith(f) : spec === f))

type Graph = {
  /** file -> local files it imports */
  local: Map<string, Set<string>>
  /** file -> bare package specifiers it imports */
  external: Map<string, Set<string>>
  clientEntries: Set<string>
}

// Repo-relative, with no escape anywhere: an absolute Windows path per hop makes a four-hop chain
// unreadable, and the chain is this check's entire advantage over a bundler error.
//
// The separators are built with fromCharCode rather than written as escapes. The first version of
// this line was generated through a script and its backslashes were eaten on the way to disk,
// leaving an unterminated string literal — AGENTS.md rule 24, in the same session that keeps citing
// it. Code that needs no escape cannot lose one.
const BACKSLASH = String.fromCharCode(92)
const SLASH = String.fromCharCode(47)
const rel = (p: string) =>
  p.split(process.cwd()).join('').split(BACKSLASH).join(SLASH).replace(/^\//, '')

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

// ── Building the real graph ────────────────────────────────────────────────────────────────────

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?[^;'"]*from\s*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g

function walkFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(full))
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/** Resolve a specifier to a file on disk, or null if it is a package. */
function resolveLocal(fromFile: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null
  for (const candidate of [
    base, `${base}.ts`, `${base}.tsx`,
    join(base, 'index.ts'), join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function buildGraphFromDisk(): Graph {
  const local = new Map<string, Set<string>>()
  const external = new Map<string, Set<string>>()
  const clientEntries = new Set<string>()

  for (const file of walkFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    // The directive must be the first statement, but a licence banner or a lint disable can precede
    // it. Scanning a generous prefix rather than N lines means a formatting change cannot quietly
    // shrink the set of files considered client-side — and the count is asserted below.
    if (/^[\s\S]{0,2000}?['"]use client['"]/.test(text)) clientEntries.add(file)

    const deps = new Set<string>()
    const pkgs = new Set<string>()
    for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        const resolved = resolveLocal(file, m[1])
        if (resolved) deps.add(resolved)
        else pkgs.add(m[1])
      }
    }
    local.set(file, deps)
    external.set(file, pkgs)
  }
  return { local, external, clientEntries }
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
