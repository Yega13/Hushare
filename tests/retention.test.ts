import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RETIRE_AFTER_DAYS, WARN_BEFORE_DAYS, WARN_AFTER_DAYS } from '@/lib/retention'

// THE RETIREMENT CLOCK IS A SAFETY INTERLOCK, and its halves must move together.
//
// retire-albums deletes a free album only after the owner was warned WARN_BEFORE_DAYS ago;
// notify-expiry decides when to warn from RETIRE_AFTER_DAYS - WARN_BEFORE_DAYS. Each cron used to
// carry its own copy of both numbers with a "must mirror" comment. Drift one way and warnings stop
// going out early enough — albums quietly stop being deletable and storage accumulates forever.
// Drift the other way and the 30 days' notice the privacy policy promises shrinks without anyone
// deciding it should.
describe('the retirement interlock holds', () => {
  it('warning plus notice equals retirement, exactly', () => {
    expect(WARN_AFTER_DAYS + WARN_BEFORE_DAYS).toBe(RETIRE_AFTER_DAYS)
  })

  it('the warning goes out before deletion is possible', () => {
    expect(WARN_BEFORE_DAYS).toBeGreaterThan(0)
    expect(WARN_AFTER_DAYS).toBeLessThan(RETIRE_AFTER_DAYS)
  })

  it('matches what the privacy policy promises', () => {
    // The published copy says albums are kept 1 year and owners get 30 days' notice. This number
    // once drifted for five days — the policy stated a retention period four times shorter than
    // the enforced one. If either constant changes, the policy text changes in the same commit.
    expect(RETIRE_AFTER_DAYS).toBe(365)
    expect(WARN_BEFORE_DAYS).toBe(30)
  })

  for (const cron of ['app/api/cron/retire-albums/route.ts', 'app/api/cron/notify-expiry/route.ts']) {
    it(`${cron} reads the shared clock and declares no local copy`, () => {
      const src = readFileSync(join(process.cwd(), 'src', ...cron.split('/')), 'utf8')
      expect(src.includes("from '@/lib/retention'"), 'must import the shared constants').toBe(true)
      expect(src.includes('const RETIRE_AFTER_DAYS ='), 'a local re-declaration shadows the shared clock').toBe(false)
      expect(src.includes('const WARN_BEFORE_DAYS ='), 'a local re-declaration shadows the shared clock').toBe(false)
    })
  }
})
