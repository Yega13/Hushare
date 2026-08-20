import { describe, it, expect } from 'vitest'
import { timingSafeEqual } from '@/lib/timing-safe'
import { isOwnAlbumAsset } from '@/lib/cloudflare/r2'
import { hashPassword, verifyPassword, deriveAccessToken, verifyAccessToken, MIN_PASSWORD_LEN } from '@/lib/album-password'

// The functions that decide who may see, change or destroy someone else's album.
// A silent bug in any of these is a security incident, not a glitch.

const R2_HOST = 'videos.hushare.space'
const ALBUM_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const ALBUM_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'

describe('timingSafeEqual', () => {
  it('matches identical strings and rejects different ones', () => {
    expect(timingSafeEqual('token-abc', 'token-abc')).toBe(true)
    expect(timingSafeEqual('token-abc', 'token-abd')).toBe(false)
  })

  it('rejects on length difference without throwing', () => {
    // A naive implementation returns early here, which leaks length through timing.
    expect(timingSafeEqual('short', 'a-much-longer-token')).toBe(false)
    expect(timingSafeEqual('', 'x')).toBe(false)
  })

  it('treats empty vs empty as equal, so callers must reject empty themselves', () => {
    // Documented so nobody "fixes" this: every call site checks length > 0 BEFORE comparing.
    // If that guard is ever dropped, a missing cookie would compare equal to a missing token.
    expect(timingSafeEqual('', '')).toBe(true)
  })
})

describe('isOwnAlbumAsset — cross-album asset protection', () => {
  const own = `https://${R2_HOST}/logos/${ALBUM_A}/1234.png`

  it('accepts an asset belonging to this album', () => {
    expect(isOwnAlbumAsset(own, 'logos', ALBUM_A, R2_HOST)).toBe(true)
  })

  it("REJECTS another album's asset — the bug this exists for", () => {
    // Two requests used to delete a victim's logo: point your album at their URL, then set null.
    expect(isOwnAlbumAsset(own, 'logos', ALBUM_B, R2_HOST)).toBe(false)
  })

  it('rejects a foreign host even with a correct-looking path', () => {
    expect(isOwnAlbumAsset(`https://evil.example/logos/${ALBUM_A}/1.png`, 'logos', ALBUM_A, R2_HOST)).toBe(false)
  })

  it('rejects http and protocol-relative URLs', () => {
    expect(isOwnAlbumAsset(`http://${R2_HOST}/logos/${ALBUM_A}/1.png`, 'logos', ALBUM_A, R2_HOST)).toBe(false)
    expect(isOwnAlbumAsset(`//${R2_HOST}/logos/${ALBUM_A}/1.png`, 'logos', ALBUM_A, R2_HOST)).toBe(false)
  })

  it('rejects path traversal', () => {
    expect(isOwnAlbumAsset(`https://${R2_HOST}/logos/${ALBUM_A}/../../${ALBUM_B}/x.png`, 'logos', ALBUM_A, R2_HOST)).toBe(false)
  })

  it('rejects a prefix that only LOOKS like the album id', () => {
    // /logos/{ALBUM_A}extra/ must not satisfy a check for /logos/{ALBUM_A}/ — the trailing
    // slash is what makes this a boundary rather than a substring match.
    expect(isOwnAlbumAsset(`https://${R2_HOST}/logos/${ALBUM_A}extra/1.png`, 'logos', ALBUM_A, R2_HOST)).toBe(false)
  })

  it('rejects the right album under the wrong asset kind', () => {
    expect(isOwnAlbumAsset(own, 'sponsors', ALBUM_A, R2_HOST)).toBe(false)
  })

  it('rejects garbage instead of throwing', () => {
    expect(isOwnAlbumAsset('not a url', 'logos', ALBUM_A, R2_HOST)).toBe(false)
    expect(isOwnAlbumAsset('', 'logos', ALBUM_A, R2_HOST)).toBe(false)
  })

  it('guards every asset kind the design routes accept', () => {
    for (const kind of ['logos', 'headers', 'backgrounds', 'sponsors']) {
      const url = `https://${R2_HOST}/${kind}/${ALBUM_A}/x.png`
      expect(isOwnAlbumAsset(url, kind, ALBUM_A, R2_HOST)).toBe(true)
      expect(isOwnAlbumAsset(url, kind, ALBUM_B, R2_HOST)).toBe(false)
    }
  })
})

describe('album passwords', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct-horse')
    expect(await verifyPassword('correct-horse', stored)).toBe(true)
    expect(await verifyPassword('Correct-horse', stored)).toBe(false)
    expect(await verifyPassword('wrong', stored)).toBe(false)
  })

  it('produces a different hash each time — the salt is real', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a).not.toBe(b)
    // Both must still verify: a per-hash salt that broke verification would lock everyone out.
    expect(await verifyPassword('same-password', a)).toBe(true)
    expect(await verifyPassword('same-password', b)).toBe(true)
  })

  it('never stores the password in the hash', async () => {
    const stored = await hashPassword('super-secret-phrase')
    expect(stored).not.toContain('super-secret-phrase')
  })

  it('refuses to hash a password below the minimum', async () => {
    await expect(hashPassword('a'.repeat(MIN_PASSWORD_LEN - 1))).rejects.toThrow()
  })

  it('returns false rather than throwing on a malformed stored hash', async () => {
    // A corrupt row must not 500 the album — it must simply refuse entry.
    expect(await verifyPassword('anything', 'not-a-real-hash')).toBe(false)
    expect(await verifyPassword('anything', '')).toBe(false)
  })
})

describe('album access tokens', () => {
  it('accepts a token minted for this album', async () => {
    const stored = await hashPassword('let-me-in')
    const token = await deriveAccessToken(stored, ALBUM_A)
    expect(await verifyAccessToken(token, stored, ALBUM_A)).toBe(true)
  })

  it("REJECTS a token minted for a DIFFERENT album", async () => {
    // Unlocking one album must never unlock another, even with the same password.
    const stored = await hashPassword('let-me-in')
    const tokenForA = await deriveAccessToken(stored, ALBUM_A)
    expect(await verifyAccessToken(tokenForA, stored, ALBUM_B)).toBe(false)
  })

  it('REJECTS a token after the password changes', async () => {
    // Changing the password is the ONLY revocation mechanism, so this is the whole of it.
    const oldHash = await hashPassword('old-password')
    const token = await deriveAccessToken(oldHash, ALBUM_A)
    const newHash = await hashPassword('new-password')
    expect(await verifyAccessToken(token, newHash, ALBUM_A)).toBe(false)
  })

  it('rejects a forged or tampered token', async () => {
    const stored = await hashPassword('let-me-in')
    const token = await deriveAccessToken(stored, ALBUM_A)
    expect(await verifyAccessToken(token.slice(0, -1) + 'x', stored, ALBUM_A)).toBe(false)
    expect(await verifyAccessToken('', stored, ALBUM_A)).toBe(false)
    expect(await verifyAccessToken('forged', stored, ALBUM_A)).toBe(false)
  })

  it('still accepts the PREVIOUS time bucket, so a guest is not evicted mid-event', async () => {
    // Tokens rotate on a 7-day bucket and the previous one stays valid, which is what stops an
    // unlocked guest being asked for the password again while the bucket rolls over.
    const stored = await hashPassword('let-me-in')
    const current = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000))
    const previous = await deriveAccessToken(stored, ALBUM_A, current - 1)
    expect(await verifyAccessToken(previous, stored, ALBUM_A)).toBe(true)
  })

  it('rejects a bucket that is too old', async () => {
    const stored = await hashPassword('let-me-in')
    const current = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000))
    const ancient = await deriveAccessToken(stored, ALBUM_A, current - 5)
    expect(await verifyAccessToken(ancient, stored, ALBUM_A)).toBe(false)
  })
})
