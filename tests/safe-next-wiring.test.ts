import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { stripJsComments } from './helpers/source-text'

// EVERY `next` CHECK IS lib/safe-next, AND NO NEW COPY OF THE OLD ONE APPEARS.
//
// The same broken check -- parse, compare origins, redirect to pathname + search -- was written six times,
// and all six let https://hushare.space//evil.example through. One tested function now answers it; this
// pins the six call sites by name and scans the rest of src for the old shape coming back (rule 13).

const SRC = join(process.cwd(), 'src')
const read = (rel: string) => stripJsComments(readFileSync(join(SRC, ...rel.split('/')), 'utf8'))

const CALL_SITES = [
  'app/auth/callback/route.ts',
  'app/api/auth/confirm/route.ts',
  'app/login/page.tsx',
  'app/login/LoginForm.tsx',
  'components/SignInPrompt.tsx',
  'app/api/auth/tiktok/start/route.ts',
]

// The old shape: an origin comparison followed closely by pathname + search.
const OLD_CHECK = /\.origin\s*[!=]==[\s\S]{0,160}?\.pathname\s*\+\s*\w+\.search/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(e.name)) out.push(full)
  }
  return out
}

describe('the `next` checks', () => {
  for (const site of CALL_SITES) {
    it(`${site} asks safeNextPath and keeps no check of its own`, () => {
      const text = read(site)
      expect(text).toContain("from '@/lib/safe-next'")
      expect(text).toContain('safeNextPath(')
      expect(text, 'the old same-origin-then-pathname check is back').not.toMatch(OLD_CHECK)
    })
  }

  it('the old check is nowhere else in src', () => {
    const offenders = walk(SRC)
      .filter((f) => !f.endsWith(join('lib', 'safe-next.ts')))
      .filter((f) => OLD_CHECK.test(stripJsComments(readFileSync(f, 'utf8'))))
      .map((f) => f.slice(SRC.length + 1))
    expect(offenders).toEqual([])
  })

  it('the scan can see the shape it forbids', () => {
    expect(OLD_CHECK.test("if (parsed.origin === origin) next = parsed.pathname + parsed.search")).toBe(true)
  })
})
