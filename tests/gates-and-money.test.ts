import { describe, it, expect } from 'vitest'
import { gateAllowsContribution, type AlbumGateRow } from '@/lib/server/album-access'
import { deriveAccessToken, hashPassword } from '@/lib/album-password'
import { isSubActive } from '@/lib/subscriptions'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { safeExtForMime, isAllowedImage, isAllowedVideo } from '@/lib/cloudflare/r2'

// The gate decides who may add photos to a locked album. isSubActive decides who keeps paid
// features and whose album survives retirement. Both are checked with real inputs, not mocks —
// the cookie store is a two-line interface, so there is nothing to fake.

const ALBUM_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OWNER_TOKEN = 'owner-token-256-bits-worth-of-secret'

/** The exact shape album-access asks for: `.get(name)` returning `{value}` or undefined. */
function cookies(jar: Record<string, string> = {}) {
  return { get: (name: string) => (name in jar ? { value: jar[name] } : undefined) }
}

const open: AlbumGateRow = { id: ALBUM_ID, owner_token: OWNER_TOKEN, password_hash: null, reveal_at: null }

describe('gateAllowsContribution — who may add photos', () => {
  it('allows anyone on an ungated album', async () => {
    expect((await gateAllowsContribution(open, cookies())).ok).toBe(true)
  })

  it('BLOCKS a stranger from a password-protected album', async () => {
    // The bug this gate exists for: knowing the album id was once enough to keep adding photos to
    // a protected album, including after the password was changed to revoke someone.
    const album = { ...open, password_hash: await hashPassword('secret-pass') }
    expect((await gateAllowsContribution(album, cookies())).ok).toBe(false)
  })

  it('allows a guest who actually unlocked it', async () => {
    const hash = await hashPassword('secret-pass')
    const album = { ...open, password_hash: hash }
    const token = await deriveAccessToken(hash, ALBUM_ID)
    expect((await gateAllowsContribution(album, cookies({ [`hushare_pw_${ALBUM_ID}`]: token }))).ok).toBe(true)
  })

  it("BLOCKS a token minted for a DIFFERENT album", async () => {
    const hash = await hashPassword('secret-pass')
    const album = { ...open, password_hash: hash }
    const otherAlbumToken = await deriveAccessToken(hash, 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb')
    expect((await gateAllowsContribution(album, cookies({ [`hushare_pw_${ALBUM_ID}`]: otherAlbumToken }))).ok).toBe(false)
  })

  it('BLOCKS everyone before the reveal date', async () => {
    const album = { ...open, reveal_at: new Date(Date.now() + 86_400_000).toISOString() }
    expect((await gateAllowsContribution(album, cookies())).ok).toBe(false)
  })

  it('allows after the reveal date has passed', async () => {
    const album = { ...open, reveal_at: new Date(Date.now() - 86_400_000).toISOString() }
    expect((await gateAllowsContribution(album, cookies())).ok).toBe(true)
  })

  it('lets the OWNER through every gate', async () => {
    const album = {
      ...open,
      password_hash: await hashPassword('secret-pass'),
      reveal_at: new Date(Date.now() + 86_400_000).toISOString(),
    }
    const jar = cookies({ [`hushare_owner_${ALBUM_ID}`]: OWNER_TOKEN })
    expect((await gateAllowsContribution(album, jar)).ok).toBe(true)
  })

  it('rejects a WRONG owner token rather than trusting the cookie name', async () => {
    const album = { ...open, password_hash: await hashPassword('secret-pass') }
    const jar = cookies({ [`hushare_owner_${ALBUM_ID}`]: 'not-the-real-token' })
    expect((await gateAllowsContribution(album, jar)).ok).toBe(false)
  })

  it('rejects an EMPTY owner cookie — timingSafeEqual alone would not', async () => {
    // timingSafeEqual('', '') is true, so the length guard at the call site is load-bearing.
    const album = { ...open, owner_token: '', password_hash: await hashPassword('secret-pass') }
    expect((await gateAllowsContribution(album, cookies({ [`hushare_owner_${ALBUM_ID}`]: '' }))).ok).toBe(false)
  })
})

describe('isSubActive — who keeps paid features', () => {
  const future = () => new Date(Date.now() + 30 * 86_400_000).toISOString()
  const past = () => new Date(Date.now() - 30 * 86_400_000).toISOString()

  it('keeps an active subscription inside its period', () => {
    expect(isSubActive({ status: 'active', current_period_end: future() })).toBe(true)
  })

  it('treats a null period end as a comped/manual grant', () => {
    expect(isSubActive({ status: 'active', current_period_end: null })).toBe(true)
  })

  it('ENDS an "active" row whose period expired long ago', () => {
    // The revenue leak: one dropped cancellation webhook left status 'active' forever.
    expect(isSubActive({ status: 'active', current_period_end: past() })).toBe(false)
  })

  it('grants a grace window so a late webhook never cuts off a payer', () => {
    // Ended yesterday: still active. A false negative here locks out a paying customer.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString()
    expect(isSubActive({ status: 'active', current_period_end: yesterday })).toBe(true)
  })

  it('honours trialing, canceled and past_due only until their period ends', () => {
    for (const status of ['trialing', 'canceled', 'past_due']) {
      expect(isSubActive({ status, current_period_end: future() })).toBe(true)
      expect(isSubActive({ status, current_period_end: past() })).toBe(false)
      expect(isSubActive({ status, current_period_end: null })).toBe(false)
    }
  })

  it('refuses an unknown status rather than guessing', () => {
    expect(isSubActive({ status: 'unpaid', current_period_end: future() })).toBe(false)
    expect(isSubActive({ status: '', current_period_end: future() })).toBe(false)
  })
})

describe('forbidCrossSiteRequest — CSRF', () => {
  const post = (origin?: string) =>
    new Request('https://hushare.space/api/x', { method: 'POST', ...(origin ? { headers: { origin } } : {}) })

  it('allows our own origins', () => {
    expect(forbidCrossSiteRequest(post('https://hushare.space'))).toBeNull()
    expect(forbidCrossSiteRequest(post('https://www.hushare.space'))).toBeNull()
  })

  it('blocks another site', () => {
    expect(forbidCrossSiteRequest(post('https://evil.example'))).not.toBeNull()
  })

  it('blocks a lookalike domain', () => {
    expect(forbidCrossSiteRequest(post('https://hushare.space.evil.example'))).not.toBeNull()
    expect(forbidCrossSiteRequest(post('https://nothushare.space'))).not.toBeNull()
  })

  it('blocks a mutating request with NO origin — curl and server callers included', () => {
    expect(forbidCrossSiteRequest(post())).not.toBeNull()
  })

  it('blocks the literal null origin (sandboxed iframes, data: URLs)', () => {
    expect(forbidCrossSiteRequest(post('null'))).not.toBeNull()
  })

  it('allows GET without an origin — ordinary navigation', () => {
    expect(forbidCrossSiteRequest(new Request('https://hushare.space/x'))).toBeNull()
  })
})

describe('safeExtForMime — the client never chooses the stored extension', () => {
  it('forces the canonical extension for HEIC regardless of the filename', () => {
    expect(safeExtForMime('image/heic', 'jpg')).toBe('heic')
  })

  it('ignores a mismatched client extension', () => {
    expect(safeExtForMime('image/png', 'exe')).toBe('png')
    expect(safeExtForMime('image/png', '../../evil')).toBe('png')
  })

  it('falls back to .bin for an unknown type instead of trusting the client', () => {
    expect(safeExtForMime('application/x-msdownload', 'exe')).toBe('bin')
  })

  it('keeps a legitimate alternative spelling', () => {
    expect(safeExtForMime('image/jpeg', 'jpeg')).toBe('jpeg')
  })
})

describe('allowed upload types', () => {
  it('accepts the formats phones actually produce', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/heic']) expect(isAllowedImage(t)).toBe(true)
    for (const t of ['video/mp4', 'video/quicktime', 'video/webm']) expect(isAllowedVideo(t)).toBe(true)
  })

  it('REJECTS SVG — it is an executable document, not a picture', () => {
    expect(isAllowedImage('image/svg+xml')).toBe(false)
  })

  it('rejects anything else', () => {
    for (const t of ['text/html', 'application/pdf', 'application/javascript', '']) {
      expect(isAllowedImage(t)).toBe(false)
      expect(isAllowedVideo(t)).toBe(false)
    }
  })
})

// ── The signed-in owner ──────────────────────────────────────────────────────────────────────────
//
// A paying customer created an album, uploaded four photos while it was still open — anyone may add
// to an open album, so no ownership was demanded — then set a password from another tab. The next
// 163 uploads were refused: the owner cookie had never been set in the tab she was uploading from,
// and the gate had no other way to recognise her. She was signed in, on her own album, throughout.
//
// The owner cookie proves possession of a link that is meant to be shareable. A session proves who
// someone is.
describe('gateAllowsContribution recognises the signed-in owner', () => {
  const OWNER_ID = '11111111-2222-4333-8444-555555555555'
  const locked: AlbumGateRow = {
    id: ALBUM_ID,
    owner_token: OWNER_TOKEN,
    password_hash: null,
    reveal_at: null,
    user_id: OWNER_ID,
  }

  it('lets the owner upload to their own locked album with no cookies at all', async () => {
    const withPassword = { ...locked, password_hash: await hashPassword('hunter2') }
    expect((await gateAllowsContribution(withPassword, cookies(), OWNER_ID)).ok).toBe(true)
  })

  it('still refuses a signed-in stranger', async () => {
    const withPassword = { ...locked, password_hash: await hashPassword('hunter2') }
    const other = '99999999-8888-4777-8666-555555555555'
    expect((await gateAllowsContribution(withPassword, cookies(), other)).ok).toBe(false)
  })

  it('never lets a signed-out visitor through on a guest album', async () => {
    // Both sides null must not be treated as a match — that would open every guest album to
    // everyone the moment it had a password.
    const guestAlbum = { ...locked, user_id: null, password_hash: await hashPassword('hunter2') }
    expect((await gateAllowsContribution(guestAlbum, cookies(), null)).ok).toBe(false)
    expect((await gateAllowsContribution(guestAlbum, cookies(), undefined)).ok).toBe(false)
  })

  it('says WHICH credential was missing', async () => {
    const withPassword = { ...locked, password_hash: await hashPassword('hunter2') }
    const refused = await gateAllowsContribution(withPassword, cookies(), null)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.reason).toBe('password-cookie-absent')
  })
})
