import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

// THE IMPORT GRAPH OF src/, BUILT FROM DISK.
//
// Shared by tests/boundaries (no credential reaches a browser file) and tests/marketing-bundle (no
// Supabase client reaches a marketing page), so both rules walk one graph with one idea of what an
// import is and where it resolves -- two copies of this would disagree about exactly the edge case a
// rule exists to catch (rule 13).

export const SRC = join(process.cwd(), 'src')

export type Graph = {
  /** file -> local files it imports */
  local: Map<string, Set<string>>
  /** file -> bare package specifiers it imports */
  external: Map<string, Set<string>>
  clientEntries: Set<string>
}

// Repo-relative, with no escape anywhere: an absolute Windows path per hop makes a four-hop chain
// unreadable, and the chain is these checks' entire advantage over a bundler error.
//
// The separators are built with fromCharCode rather than written as escapes. The first version of
// this line was generated through a script and its backslashes were eaten on the way to disk,
// leaving an unterminated string literal — AGENTS.md rule 24. Code that needs no escape cannot lose one.
const BACKSLASH = String.fromCharCode(92)
const SLASH = String.fromCharCode(47)
export const rel = (p: string) =>
  p.split(process.cwd()).join('').split(BACKSLASH).join(SLASH).replace(/^\//, '')

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

export function buildGraphFromDisk(): Graph {
  const local = new Map<string, Set<string>>()
  const external = new Map<string, Set<string>>()
  const clientEntries = new Set<string>()

  for (const file of walkFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    // The directive must be the first statement, but a licence banner or a lint disable can precede
    // it. Scanning a generous prefix rather than N lines means a formatting change cannot quietly
    // shrink the set of files considered client-side — and the count is asserted in tests/boundaries.
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
