import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// WHO MAY ADD TO A PRIVATE ALBUM, and the three proofs the gate accepts.
//
// tests/gates-and-money.test.ts owns the password and reveal behaviour with real hashes and no
// mocks. What could not live there is anything about the SESSION: gateAllowsContribution takes the
// signed-in account as an argument, and signedInUserForGate is the thing that fetches it -- which
// needs the Supabase server client mocked, and that file deliberately mocks nothing.
//
// A mutation run on 2026-09-11 found seven survivors in this module, and every one of them is here:
// the session lookup running on albums that are not gated at all (an auth round trip per upload at
// an event), a failed lookup throwing out of the gate instead of answering "nobody", an owner
// cookie accepted on a PREFIX of the real token, the two password-refusal reasons collapsing into
// one, and the gate's own column list quietly losing a column it reads.

const cfg: { userId: string | null; getUserThrows: boolean; getUserCalls: number } = {
  userId: 'account-1', getUserThrows: false, getUserCalls: 0,
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => {
        cfg.getUserCalls++
        if (cfg.getUserThrows) throw new Error('auth is down')
        return { data: { user: cfg.userId ? { id: cfg.userId } : null } }
      },
    },
  }),
}))

import { gateAllowsContribution, signedInUserForGate, ALBUM_GATE_COLS, type AlbumGateRow } from '@/lib/server/album-access'
import { hashPassword, deriveAccessToken } from '@/lib/album-password'
import { isExpectedRefusal } from '@/lib/upload-policy'

const ALBUM_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OWNER_TOKEN = 'owner-token-256-bits-worth-of-secret'
const OPEN: AlbumGateRow = { id: ALBUM_ID, owner_token: OWNER_TOKEN, password_hash: null, reveal_at: null }
const cookies = (jar: Record<string, string> = {}) => ({ get: (n: string) => (n in jar ? { value: jar[n] } : undefined) })

beforeEach(() => {
  cfg.userId = 'account-1'
  cfg.getUserThrows = false
  cfg.getUserCalls = 0
})

describe('signedInUserForGate only asks who you are when it could matter', () => {
  it('does NOT touch auth for an album with no password and no reveal date', async () => {
    // Every guest upload calls this. On an open album -- most albums, and every album during the
    // busiest hour of an event -- the answer cannot change the verdict, so the round trip is pure
    // latency on the hot path.
    expect(await signedInUserForGate({ password_hash: null, reveal_at: null })).toBe(null)
    expect(cfg.getUserCalls, 'an open album must cost no auth call at all').toBe(0)
  })

  it('does ask when a password or a reveal date is set', async () => {
    await signedInUserForGate({ password_hash: 'pbkdf2$100000$x$y', reveal_at: null })
    expect(cfg.getUserCalls).toBe(1)
    await signedInUserForGate({ password_hash: null, reveal_at: '2030-01-01T00:00:00.000Z' })
    expect(cfg.getUserCalls).toBe(2)
  })

  it('answers "nobody" when auth is down, instead of throwing out of the gate', async () => {
    // Erring toward the weaker proof, deliberately: the cookie and the password still work, so a
    // Supabase blip degrades to "not recognised as the owner" rather than 500ing every upload in
    // the album (rule 19).
    cfg.getUserThrows = true
    await expect(signedInUserForGate({ password_hash: 'pbkdf2$100000$x$y', reveal_at: null })).resolves.toBe(null)
  })

  it('answers null when nobody is signed in', async () => {
    cfg.userId = null
    expect(await signedInUserForGate({ password_hash: 'pbkdf2$100000$x$y', reveal_at: null })).toBe(null)
  })
})

describe('the owner cookie must match in FULL', () => {
  it('a prefix of the real token is not the real token', async () => {
    // `startsWith` reads as a match and is one an attacker can walk: it turns a 256-bit secret into
    // a character-at-a-time guess, and the per-album limiter allows thousands of tries an hour.
    const album = { ...OPEN, password_hash: await hashPassword('secret-pass') }
    for (const guess of [OWNER_TOKEN.slice(0, 1), OWNER_TOKEN.slice(0, 10), OWNER_TOKEN.slice(0, OWNER_TOKEN.length - 1)]) {
      const res = await gateAllowsContribution(album, cookies({ [`hushare_owner_${ALBUM_ID}`]: guess }))
      expect(res.ok, `"${guess}" must not open the album`).toBe(false)
    }
  })

  it('and a token with anything appended is not it either', async () => {
    const album = { ...OPEN, password_hash: await hashPassword('secret-pass') }
    const res = await gateAllowsContribution(album, cookies({ [`hushare_owner_${ALBUM_ID}`]: `${OWNER_TOKEN}x` }))
    expect(res.ok).toBe(false)
  })
})

describe('the signed-in account is the second proof, and only for the real owner', () => {
  const gated = async () => ({ ...OPEN, user_id: 'account-1', password_hash: await hashPassword('secret-pass') })

  it('the OWNER of the album gets through with no cookie at all', async () => {
    // The incident: a paying customer set a password from another tab, and her next 163 uploads
    // were refused because that tab had never been given an owner cookie. She was signed in, on
    // her own album, the whole time.
    const res = await gateAllowsContribution(await gated(), cookies(), 'account-1')
    expect(res.ok).toBe(true)
  })

  it('a DIFFERENT signed-in account does not', async () => {
    const res = await gateAllowsContribution(await gated(), cookies(), 'account-2')
    expect(res.ok).toBe(false)
  })

  it('a GUEST album is owned by nobody, so a null session is not a match', async () => {
    // null === null is the trap. An album with no account behind it must not be opened by any
    // visitor who also happens to be signed out.
    const album = { ...OPEN, user_id: null, password_hash: await hashPassword('secret-pass') }
    expect((await gateAllowsContribution(album, cookies(), null)).ok).toBe(false)
    expect((await gateAllowsContribution(album, cookies(), undefined)).ok).toBe(false)
    expect((await gateAllowsContribution(album, cookies(), '')).ok).toBe(false)
  })
})

describe('the refusal says WHICH of the two things went wrong', () => {
  // The two need opposite fixes: absent means they never unlocked on this device (ask for the
  // password), stale means the password was changed underneath somebody who had (tell them so).
  // Collapsing them makes the product guess, and the guess is wrong half the time.
  const locked = async () => ({ ...OPEN, password_hash: await hashPassword('secret-pass') })

  it('absent: no password cookie at all', async () => {
    const res = await gateAllowsContribution(await locked(), cookies())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('password-cookie-absent')
  })

  it('stale: a password cookie that no longer verifies', async () => {
    const album = await locked()
    const forOtherAlbum = await deriveAccessToken(album.password_hash as string, 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb')
    const res = await gateAllowsContribution(album, cookies({ [`hushare_pw_${ALBUM_ID}`]: forOtherAlbum }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('password-cookie-stale')
  })

  it('owner-cookie-mismatch: an owner cookie is present but wrong', async () => {
    const res = await gateAllowsContribution(await locked(), cookies({ [`hushare_owner_${ALBUM_ID}`]: 'stale-token' }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('owner-cookie-mismatch')
  })

  it('and its WORDING is its own too, which two other things depend on', async () => {
    // A sealed album telling a guest to "enter the album password" sends them looking for one that
    // does not exist (rule 20). Worse, this exact sentence is a prefix in upload-policy's
    // EXPECTED_REFUSAL_PREFIXES: reword it and the refusal stops being recognised as deliberate,
    // so it files as an error in the admin panel AND reads as a network failure to the video lane,
    // which collapses that guest's uploads to serial for the rest of the session.
    const album = { ...OPEN, reveal_at: new Date(Date.now() + 86_400_000).toISOString() }
    const res = await gateAllowsContribution(album, cookies())
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('This album has not been revealed yet')
      expect(isExpectedRefusal(res.error), 'upload-policy must recognise it as a deliberate refusal').toBe(true)
    }
  })

  it('the password refusal is worded for the thing it is, and is recognised too', async () => {
    const res = await gateAllowsContribution(await locked(), cookies())
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('Enter the album password before adding photos')
      expect(isExpectedRefusal(res.error)).toBe(true)
    }
  })

  it('REVEAL BEFORE PASSWORD on an album that carries both', async () => {
    // The precedence is the rule, not an accident of writing order, and one line now decides it for
    // all three callers. Asking the password first would let somebody who has it open a SEALED
    // album early -- they were given the password for after the reveal, not before it.
    const album = {
      ...OPEN,
      password_hash: await hashPassword('secret-pass'),
      reveal_at: new Date(Date.now() + 86_400_000).toISOString(),
    }
    const hash = album.password_hash
    const unlocked = cookies({ [`hushare_pw_${ALBUM_ID}`]: await deriveAccessToken(hash, ALBUM_ID) })
    const res = await gateAllowsContribution(album, unlocked)
    expect(res.ok, 'a correct password must not open a sealed album').toBe(false)
    if (!res.ok) expect(res.reason).toBe('not-revealed')
  })

  it('not-revealed is its own reason, not a password problem', async () => {
    const album = { ...OPEN, reveal_at: new Date(Date.now() + 86_400_000).toISOString() }
    const res = await gateAllowsContribution(album, cookies())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('not-revealed')
  })
})

describe('the gate asks the database for every column it reads', () => {
  it('ALBUM_GATE_COLS covers every album field gateAllowsContribution touches', () => {
    // A column missing from the select is `undefined` at runtime, and every one of these fails
    // OPEN when undefined: no password_hash reads as an unprotected album, no reveal_at as a
    // revealed one, no user_id as an album the signed-in owner cannot be recognised on. Nothing
    // throws, nothing logs, and the gate simply stops gating.
    //
    // Derived from the function's own source rather than listed by hand, so a new `album.<field>`
    // arrives already held.
    // THE SLICE MUST COVER THE WHOLE GATE. On 2026-09-11 the shared decision moved into
    // albumGateVerdict, which sits ABOVE this function -- so the two fields that matter
    // (password_hash, reveal_at) fell outside the window and this test went on passing while
    // deriving three names instead of five. A review caught it. The window is both bodies now, and
    // the count below is a floor high enough to notice if one of them slips out again.
    const src = readFileSync(join(process.cwd(), 'src', 'lib', 'server', 'album-access.ts'), 'utf8')
    const start = src.indexOf('export function revealPending(')
    expect(start, 'the shared verdict must still be in this file').toBeGreaterThan(-1)
    const end = src.indexOf('export type PhotosResult', start)
    expect(end, 'and the window must not be inverted or empty').toBeGreaterThan(start)
    const body = src.slice(start, end)
    const fields = new Set([...body.matchAll(/\balbum\.([a-z_]+)\b/g)].map((m) => m[1]))
    expect(fields.size, 'the gate reads id, owner_token, password_hash, reveal_at and user_id')
      .toBeGreaterThanOrEqual(5)
    const selected = ALBUM_GATE_COLS.split(',').map((c) => c.trim())
    for (const field of fields) {
      if (field === 'id') continue // the row id is always present; it is not a selected gate column
      expect(selected, `the gate reads album.${field} but ALBUM_GATE_COLS does not ask for it`).toContain(field)
    }
  })

  it('and asks for nothing it does not read', () => {
    expect(ALBUM_GATE_COLS.split(',').map((c) => c.trim()).sort())
      .toEqual(['owner_token', 'password_hash', 'reveal_at', 'user_id'])
  })
})
