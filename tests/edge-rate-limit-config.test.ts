import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { READ_LIMITS, READ_LIMIT_PERIOD_SECONDS } from '@/lib/server/edge-rate-limit'
import { stripJsComments } from './helpers/source-text'

// THE EDGE READ LIMITS, WRITTEN DOWN TWICE AND HELD EQUAL.
//
// Cloudflare's rate limiting binding is configured in wrangler.toml, which code inside the Worker cannot
// read, so lib/server/edge-rate-limit restates each limit (rule 13: the copy is unavoidable, so a test
// holds it to the real source). A binding missing from one environment is not a crash: readRateLimit
// falls back to the database limiter, which keeps the protection and silently puts back the round trip
// this whole change exists to remove. So both environments are checked, block by block.

const root = process.cwd()
const wrangler = readFileSync(join(root, 'wrangler.toml'), 'utf8')
const NL = String.fromCharCode(10)

type Block = { name: string; namespace: string | null; limit: number | null; period: number | null; staging: boolean }

/** Every [[ratelimits]] / [[env.staging.ratelimits]] block, with the values under its `simple` table. */
function ratelimitBlocks(toml: string): Block[] {
  const blocks: Block[] = []
  let current: Block | null = null
  for (const line of toml.split(NL)) {
    const header = /^\s*\[\[(env\.staging\.)?ratelimits\]\]\s*$/.exec(line)
    if (header) {
      current = { name: '', namespace: null, limit: null, period: null, staging: !!header[1] }
      blocks.push(current)
      continue
    }
    // Any other table header ends the block, except the block's own `simple` sub-table.
    if (current && /^\s*\[/.test(line) && !/ratelimits\.simple\]/.test(line)) { current = null; continue }
    if (!current) continue
    const name = /^\s*name\s*=\s*"([^"]+)"/.exec(line)
    const ns = /^\s*namespace_id\s*=\s*"([^"]+)"/.exec(line)
    const limit = /^\s*limit\s*=\s*(\d+)/.exec(line)
    const period = /^\s*period\s*=\s*(\d+)/.exec(line)
    if (name) current.name = name[1]
    if (ns) current.namespace = ns[1]
    if (limit) current.limit = Number(limit[1])
    if (period) current.period = Number(period[1])
  }
  return blocks
}

const blocks = ratelimitBlocks(wrangler)

describe('the edge read limits in wrangler.toml', () => {
  it('the parser sees every ratelimits block the file declares', () => {
    const declared = (wrangler.match(/^\s*\[\[(env\.staging\.)?ratelimits\]\]\s*$/gm) ?? []).length
    expect(declared).toBeGreaterThan(0)
    expect(blocks.length).toBe(declared)
    for (const b of blocks) expect(b.name, 'a ratelimits block whose name this parser cannot read').not.toBe('')
  })

  for (const [route, spec] of Object.entries(READ_LIMITS)) {
    it(`${spec.binding} (${route}) exists in production AND staging, with the same limit and a ${READ_LIMIT_PERIOD_SECONDS}s period`, () => {
      const mine = blocks.filter((b) => b.name === spec.binding)
      expect(mine.map((b) => b.staging).sort(), `${spec.binding} must be declared once per environment`).toEqual([false, true])
      for (const b of mine) {
        expect(b.limit, `${spec.binding} ${b.staging ? 'staging' : 'production'} limit`).toBe(spec.perMinute)
        expect(b.period, `${spec.binding} ${b.staging ? 'staging' : 'production'} period`).toBe(READ_LIMIT_PERIOD_SECONDS)
      }
    })
  }

  it('no two limiters share a namespace within an environment -- a shared namespace is a shared counter', () => {
    for (const staging of [false, true]) {
      const ids = blocks.filter((b) => b.staging === staging).map((b) => b.namespace)
      expect(new Set(ids).size, staging ? 'staging' : 'production').toBe(ids.length)
    }
  })
})

describe('each read route asks its own edge limit', () => {
  const route = (...p: string[]) => stripJsComments(readFileSync(join(root, 'src', 'app', 'api', ...p), 'utf8'))
  const cases: Array<[string, string[]]> = [
    ['albumPhotos', ['album', 'photos', 'route.ts']],
    ['albumResolve', ['album', 'resolve', 'route.ts']],
    ['presence', ['presence', 'route.ts']],
  ]
  for (const [name, path] of cases) {
    it(`${path.join('/')} uses readRateLimit(req, '${name}') and no database limiter`, () => {
      const src = route(...path)
      expect(src).toContain(`readRateLimit(req, '${name}')`)
      expect(src).not.toContain('checkRateLimit(')
    })
  }
})
