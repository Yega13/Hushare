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

  it('verification still accepts a 4-character password — proven against a REAL hash', async () => {
    // THIS TEST USED TO PROVE NOTHING, and a mutation run caught it: it asserted
    // `verifyPassword('1234', <fake hash>) === false`, which is false whether the floor is 4, 6, or
    // absent, because a fake hash can never match. Changing verifyPassword to compare against
    // MIN_NEW_PASSWORD_LEN — which locks every guest out of the eight live albums whose password is
    // 4 or 5 characters, at their event, while they type the correct password — left the entire
    // 835-test suite green.
    //
    // hashPassword refuses to MAKE a 4-character hash now, so the hash is built the way the eight
    // live rows were built: with the accept-floor still in force. That is the only construction
    // that reproduces an existing customer's stored password, and verifying it is the only
    // assertion that can distinguish the two constants.
    const legacy = await mod.hashPasswordAtLength('1234', mod.MIN_PASSWORD_LEN)
    expect(await mod.verifyPassword('1234', legacy)).toBe(true)
    expect(await mod.verifyPassword('12345', legacy)).toBe(false)
  })

  it('a five-character legacy password also still opens its album', async () => {
    const legacy = await mod.hashPasswordAtLength('12345', mod.MIN_PASSWORD_LEN)
    expect(await mod.verifyPassword('12345', legacy)).toBe(true)
  })

  it('but something below the ACCEPT floor is still refused', async () => {
    // The floor has to mean something in the other direction too, or "accepts 4" is just "accepts
    // anything" and the mutation above would still pass.
    const legacy = await mod.hashPasswordAtLength('123', 1)
    expect(await mod.verifyPassword('123', legacy)).toBe(false)
  })
})
