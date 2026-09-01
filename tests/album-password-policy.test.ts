import { describe, it, expect, beforeAll } from 'vitest'

// HOW SHORT AN ALBUM PASSWORD MAY BE — two different questions, and collapsing them breaks people.
//
// The password protects a wedding album, and since gateAllowsContribution started consulting it,
// it protects UPLOADING to that album too. The per-album limiter allows roughly 34,500 attempts a
// day with no lockout, so a 4-character PIN — the obvious choice for a sign on a table — falls in
// a few hours, and cracking it now buys write access rather than a look.
//
// So the minimum for a NEW password went up. The minimum we ACCEPT did not, and must not: eight
// live albums already have a password, and raising the verify floor would turn real guests away at
// a real event while they type something correct. That is a worse failure than the one being
// fixed, and it is the same reasoning MIN_VERIFY_ITERATIONS encodes for old hashes.
//
// This file exists because the first mutation run "proved" the policy with a test file that did not
// exist — vitest exited non-zero for having no tests, which reads exactly like a caught mutation.
let mod: typeof import('@/lib/album-password')

beforeAll(async () => {
  process.env.ALBUM_PASSWORD_PEPPER ??= 'test-pepper-value-not-a-real-secret'
  mod = await import('@/lib/album-password')
})

describe('setting a password', () => {
  it('refuses anything shorter than the new minimum', async () => {
    await expect(mod.hashPassword('12345')).rejects.toThrow()
    await expect(mod.hashPassword('abc')).rejects.toThrow()
  })

  it('accepts the new minimum and round-trips', async () => {
    const stored = await mod.hashPassword('sixchr')
    expect(stored.startsWith('pbkdf2$')).toBe(true)
    expect(await mod.verifyPassword('sixchr', stored)).toBe(true)
    expect(await mod.verifyPassword('sixchx', stored)).toBe(false)
  })
})

describe('the two minimums are deliberately different', () => {
  it('what we accept is lower than what we now allow to be set', () => {
    // The property that keeps the eight existing password-protected albums working. If these ever
    // become equal, every guest whose album password is 4 or 5 characters is locked out — by us,
    // while typing the correct password.
    expect(mod.MIN_PASSWORD_LEN).toBeLessThan(mod.MIN_NEW_PASSWORD_LEN)
  })

  it('a new password must be at least 6', () => {
    // Named explicitly so lowering it is a visible decision rather than a quiet edit.
    expect(mod.MIN_NEW_PASSWORD_LEN).toBeGreaterThanOrEqual(6)
  })

  it('verification still accepts a 4-character password by length', async () => {
    // Cannot be proven by round trip any more — hashPassword refuses to create one. What CAN be
    // proven is that verifyPassword does not reject it on length: a wrong-password answer and a
    // too-short answer are both `false`, so this asserts the floor the code compares against.
    expect(mod.MIN_PASSWORD_LEN).toBeLessThanOrEqual(4)
    expect(await mod.verifyPassword('1234', 'pbkdf2$100000$AAAA$BBBB')).toBe(false)
  })
})
