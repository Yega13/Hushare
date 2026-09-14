import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE CACHE RULES CLOUDFLARE APPLIES TO STATIC FILES.
//
// Without public/_headers every static file was served with "public, max-age=0, must-revalidate"
// (measured in production 2026-09-14), including the content-hashed build chunks that can never
// change under their own name. The OpenNext build copies public/ into the assets folder Cloudflare
// serves (createStaticAssets in @opennextjs/aws), so this file is what the browser actually gets.
//
// Two ways to get it wrong, both silent: losing the rule (every repeat visit re-asks for every
// script), and marking a file immutable whose NAME does not change when its content does (a replaced
// font or logo stays stale in guests' browsers for a year, with no way to push the new one).

const NEWLINE = String.fromCharCode(10)
const text = readFileSync(join(process.cwd(), 'public', '_headers'), 'utf8').split(String.fromCharCode(13)).join('')

/** The file as rules: a path line, then its indented header lines. Comments and blank lines ignored. */
function rules(): Array<{ path: string; headers: string[] }> {
  const out: Array<{ path: string; headers: string[] }> = []
  for (const line of text.split(NEWLINE)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) out.push({ path: line.trim(), headers: [] })
    else out.at(-1)?.headers.push(line.trim())
  }
  return out
}

describe('public/_headers', () => {
  it('lets browsers keep the content-hashed build output for a year without asking again', () => {
    const rule = rules().find((r) => r.path === '/_next/static/*')
    expect(rule, 'the build-output rule is missing').toBeDefined()
    expect(rule?.headers).toContain('Cache-Control: public,max-age=31536000,immutable')
  })

  it('marks NOTHING ELSE immutable -- every other file in public/ keeps its name when it is replaced', () => {
    const immutable = rules().filter((r) => r.headers.some((h) => /immutable/i.test(h))).map((r) => r.path)
    expect(immutable).toEqual(['/_next/static/*'])
  })

  it("stays inside Cloudflare's limits: 100 rules, 2,000 characters a line", () => {
    expect(rules().length).toBeLessThanOrEqual(100)
    for (const line of text.split(NEWLINE)) expect(line.length).toBeLessThanOrEqual(2000)
  })
})
