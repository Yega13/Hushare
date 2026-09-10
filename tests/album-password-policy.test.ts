import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest'

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


// ── WHAT THE GATE DOES WITH A HASH IT DID NOT WRITE ──────────────────────────────────────────────
//
// Everything below was added on 2026-09-10 after a mutation run: nine mutations of this module
// survived the whole suite, including "a hash claiming one iteration is accepted" and "the legacy
// comparison always matches". The length policy above was thoroughly held; the stored format was
// not held at all.
//
// The live shape, read from the database rather than assumed (rule 18): all 10 albums that have a
// password store `pbkdf2` in 4 segments at 100,000 iterations. There is not one legacy row.

const b64 = (n: number, fill: number) => Buffer.from(new Uint8Array(n).fill(fill)).toString('base64')
const SALT = b64(16, 7)
const DIGEST = b64(32, 9)

afterEach(() => { vi.restoreAllMocks() })

describe('a stored hash is not believed just because it parses', () => {
  it('refuses a hash claiming fewer iterations than the verify floor', async () => {
    // A downgraded or corrupted row must not become a password that verifies in milliseconds.
    expect(await mod.verifyPassword('correct-horse', `pbkdf2$1000$${SALT}$${DIGEST}`)).toBe(false)
    expect(await mod.verifyPassword('correct-horse', `pbkdf2$1$${SALT}$${DIGEST}`)).toBe(false)
  })

  it('refuses an iteration count that is not a number, instead of throwing on it', async () => {
    // Number.parseInt('abc') is NaN, and `NaN < floor` is false -- so without the isFinite check
    // this reaches PBKDF2 with NaN rounds and throws out of the gate, 500ing the album page.
    await expect(mod.verifyPassword('correct-horse', `pbkdf2$abc$${SALT}$${DIGEST}`)).resolves.toBe(false)
    await expect(mod.verifyPassword('correct-horse', `pbkdf2$$${SALT}$${DIGEST}`)).resolves.toBe(false)
  })

  it('refuses an iteration count above what the runtime can verify', async () => {
    // workerd throws NotSupportedError above 100k. Reaching it would 500 the page rather than
    // refuse, so the number is checked before it is used.
    expect(await mod.verifyPassword('correct-horse', `pbkdf2$600000$${SALT}$${DIGEST}`)).toBe(false)
  })

  it('refuses a hash with anything appended to it', async () => {
    // The real hash, plus a fifth segment. Without the segment-count check the extra is ignored,
    // the row verifies normally, and a value nobody wrote is treated as the album's password.
    const real = await mod.hashPassword('correct-horse')
    expect(await mod.verifyPassword('correct-horse', real), 'the fixture must be a real hash').toBe(true)
    expect(await mod.verifyPassword('correct-horse', `${real}$anything`)).toBe(false)
  })

  it('the legacy hmac format cannot be made to match', async () => {
    // Zero live rows use it (checked against the database), but the branch is still reachable from
    // any stored value shaped like one, and it has its own comparison. Its `matched` flag being
    // stuck true would open every album that had such a row. A well-formed legacy hash with a
    // password that was never used to build it must come back false.
    expect(await mod.verifyPassword('correct-horse', `hmac-sha256-v1$${SALT}$${DIGEST}`)).toBe(false)
  })

  it('refuses undecodable base64 rather than throwing', async () => {
    expect(await mod.verifyPassword('correct-horse', 'pbkdf2$100000$!!!!$????')).toBe(false)
    expect(await mod.verifyPassword('correct-horse', 'hmac-sha256-v1$!!!!$????')).toBe(false)
  })
})

describe('the length bounds exist to stop WORK, not just to answer no', () => {
  // The answer is false either way for a wrong password, which is why removing the upper bound
  // survived every test in the suite. What the bound actually buys is that no PBKDF2 runs at all:
  // 100,000 rounds over an attacker-supplied multi-megabyte string, on a Worker, per request.
  const derivations = () => vi.spyOn(crypto.subtle, 'deriveBits')

  it('does no key derivation for a password longer than the maximum', async () => {
    const spy = derivations()
    const stored = `pbkdf2$100000$${SALT}$${DIGEST}`
    expect(await mod.verifyPassword('x'.repeat(mod.MAX_PASSWORD_LEN + 1), stored)).toBe(false)
    expect(spy, 'an oversized password must be refused before any hashing').not.toHaveBeenCalled()
  })

  it('does no key derivation for a password below the accept floor either', async () => {
    const spy = derivations()
    expect(await mod.verifyPassword('abc', `pbkdf2$100000$${SALT}$${DIGEST}`)).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('DOES derive for a password inside the bounds -- or the two above prove nothing', async () => {
    const spy = derivations()
    await mod.verifyPassword('correct-horse', `pbkdf2$100000$${SALT}$${DIGEST}`)
    expect(spy, 'the spy must be able to see a real derivation').toHaveBeenCalled()
  })
})

describe('the cost of a stored hash is pinned, because nothing else would notice it falling', () => {
  it('hashes at 100,000 iterations -- the ceiling workerd will verify', async () => {
    // Both directions are a real failure. Lower is a cheaper offline crack of every album password
    // at once; higher throws NotSupportedError inside the Worker and 500s the save. The literal is
    // deliberate: reading the constant back from the module would assert nothing.
    expect(mod.PBKDF2_ITERATIONS).toBe(100_000)
  })

  it('and writes that number into the hash it stores, so verify reads the real cost', async () => {
    const stored = await mod.hashPassword('correct-horse')
    expect(stored.split('$')[1]).toBe(String(mod.PBKDF2_ITERATIONS))
  })
})

describe('the cookie that keeps a guest inside one album', () => {
  it('is named per album, so one album password does not open the next', () => {
    const a = mod.cookieNameForAlbum('album-one')
    const b = mod.cookieNameForAlbum('album-two')
    expect(a).toContain('album-one')
    expect(a.startsWith(mod.PASSWORD_COOKIE_PREFIX)).toBe(true)
    expect(a, 'two albums must not share a cookie').not.toBe(b)
  })

  it('outlives two token buckets, so a guest is never evicted between them', () => {
    // The token accepts the current bucket and the previous one -- 14 days of validity. A cookie
    // that expired first would log a guest out mid-event for no reason the guest can see.
    expect(mod.PASSWORD_COOKIE_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 14)
  })

  it('an empty cookie never opens an album', async () => {
    const stored = await mod.hashPassword('correct-horse')
    expect(await mod.verifyAccessToken('', stored, 'album-one')).toBe(false)
  })
})
