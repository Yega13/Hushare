import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE ONE RATE-LIMIT WINDOW THAT IS WRITTEN DOWN TWICE.
//
// Every other 429 in this codebase builds its Retry-After from checkRateLimit's own answer, so the
// number cannot drift from the rule that produced it. The support chat cannot: it uses Cloudflare's
// rate-limiting binding, which returns `{ success }` and nothing else. The only truthful number is
// the window the binding is configured with, and that lives in wrangler.toml — build configuration,
// which code running inside the Worker has no way to read.
//
// So the copy is unavoidable, and rule 13's remedy applies: a test that asserts the copies agree AND
// reads the real source rather than a third copy of it. If someone widens the limiter's period to
// 300 in wrangler.toml, this fails instead of the app quietly telling people to retry in 60 seconds
// when the door stays shut for five minutes.

const root = process.cwd()
const wrangler = readFileSync(join(root, 'wrangler.toml'), 'utf8')
const route = readFileSync(join(root, 'src/app/api/support/chat/route.ts'), 'utf8')

/** Every `period = N` belonging to a SUPPORT_CHAT_LIMITER block, production and staging. */
function supportChatPeriods(toml: string): number[] {
  const out: number[] = []
  const lines = toml.split(String.fromCharCode(10))
  let inBlock = false
  for (const line of lines) {
    if (line.includes('SUPPORT_CHAT_LIMITER')) { inBlock = true; continue }
    // A new [[...]] or [env...] header ends the block we were in.
    if (inBlock && /^\s*\[/.test(line) && !/ratelimits\.simple/.test(line)) { inBlock = false }
    if (!inBlock) continue
    const m = /^\s*period\s*=\s*(\d+)/.exec(line)
    if (m) { out.push(Number(m[1])); inBlock = false }
  }
  return out
}

describe('the support chat Retry-After matches the limiter it describes', () => {
  it('finds the limiter config at all', () => {
    // THE SCAN'S OWN REACH, asserted first. A parser that silently matched nothing would report
    // "all clear" from a blind spot, which is how tests/architecture.test.ts's walk failed twice.
    expect(wrangler).toContain('SUPPORT_CHAT_LIMITER')
    // PINNED TO THE BLOCK COUNT, not `> 0`. A review proved the weaker assertion blind: rewriting
    // one block into wrangler's valid inline form `simple = { limit = 100, period = 300 }` made the
    // parser return only the OTHER block's period, `> 0` still passed, and the loop had nothing left
    // to disagree with — so production could ship a 60s Retry-After against a 300s door.
    const blocks = (wrangler.match(/SUPPORT_CHAT_LIMITER/g) ?? []).length
    expect(
      supportChatPeriods(wrangler).length,
      'a SUPPORT_CHAT_LIMITER block exists whose period this parser cannot see — it is now blind to one',
    ).toBe(blocks)
  })

  it('finds the constant in the route at all', () => {
    expect(
      /const SUPPORT_CHAT_WINDOW_SECONDS = (\d+)/.exec(route),
      'the constant was renamed or removed — this guard is now watching nothing',
    ).not.toBeNull()
  })

  it('agrees with every SUPPORT_CHAT_LIMITER period, production and staging', () => {
    const declared = Number(/const SUPPORT_CHAT_WINDOW_SECONDS = (\d+)/.exec(route)![1])
    for (const period of supportChatPeriods(wrangler)) {
      expect(
        declared,
        `wrangler.toml configures a ${period}s window; the route tells the client to retry after ${declared}s`,
      ).toBe(period)
    }
  })
})
