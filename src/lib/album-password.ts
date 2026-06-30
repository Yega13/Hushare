const LEGACY_HASH_VERSION = 'hmac-sha256-v1'
const KEY_BITS = 256
const MIN_VERIFY_ITERATIONS = 10_000  // kept at 10k to accept existing hashes
const MAX_VERIFY_ITERATIONS = 100_000 // workerd refuses to verify PBKDF2 above 100k
// workerd (Cloudflare Workers runtime) caps PBKDF2 at 100k iterations — requesting
// more throws `NotSupportedError: iteration counts above 100000 are not supported`,
// which 500'd every album-password save. 100k PBKDF2-SHA-256 with a 16-byte random
// salt + the server-side pepper remains strong for album (not account) passwords.
export const PBKDF2_ITERATIONS = 100_000

export const MIN_PASSWORD_LEN = 4
export const MAX_PASSWORD_LEN = 128

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
    throw new Error(`[album-password] password must be ${MIN_PASSWORD_LEN}–${MAX_PASSWORD_LEN} characters`)
  }
  const [pepper] = passwordPeppers()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  // Pepper is mixed into the password input so offline cracking requires the pepper key.
  const hash = await pbkdf2(`${pepper}:${password}`, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  // Reject lengths that could never have been hashed — and prevent DoS via
  // 600k-iteration PBKDF2 on a multi-megabyte attacker-supplied string.
  if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) return false
  const parts = stored.split('$')
  if (parts.length === 3 && parts[0] === LEGACY_HASH_VERSION) {
    let salt: Uint8Array<ArrayBuffer>
    let expected: Uint8Array<ArrayBuffer>
    try {
      salt = fromBase64(parts[1])
      expected = fromBase64(parts[2])
    } catch {
      return false
    }
    // Always compute ALL pepper variants and accumulate with OR — prevents timing oracle
    // that reveals whether the primary or secondary pepper matched first.
    const peppers = passwordPeppers()
    const results = await Promise.all(peppers.map((p) => hmacPassword(password, salt, p)))
    let matched = false
    for (const actual of results) {
      if (timingSafeEqualBytes(actual, expected)) matched = true
    }
    return matched
  }

  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number.parseInt(parts[1], 10)
  if (!Number.isFinite(iterations) || iterations < MIN_VERIFY_ITERATIONS) return false
  if (iterations > MAX_VERIFY_ITERATIONS) {
    console.error(`[album-password] hash has ${iterations} iterations (max ${MAX_VERIFY_ITERATIONS}) — album password must be reset`)
    return false
  }
  let salt: Uint8Array<ArrayBuffer>
  let expected: Uint8Array<ArrayBuffer>
  try {
    salt = fromBase64(parts[2])
    expected = fromBase64(parts[3])
  } catch {
    return false
  }
  // Try all pepper variants — supports rotation without forcing re-login.
  // All variants always computed (no short-circuit) to prevent timing oracle.
  const peppers = passwordPeppers()
  let matched = false
  for (const pepper of peppers) {
    const actual = await pbkdf2(`${pepper}:${password}`, salt, iterations)
    if (timingSafeEqualBytes(actual, expected)) matched = true
  }
  return matched
}

// 7-day buckets: stolen cookies expire within a week; previous bucket accepted for rolling validity
const TOKEN_BUCKET_SECONDS = 60 * 60 * 24 * 7

function currentTimeBucket(): number {
  return Math.floor(Date.now() / 1000 / TOKEN_BUCKET_SECONDS)
}

export async function deriveAccessToken(passwordHash: string, albumId: string, bucket?: number): Promise<string> {
  const b = bucket ?? currentTimeBucket()
  // Use only the hash component (last '$'-separated segment) as HMAC key material.
  // This avoids silent token invalidation if the stored format ever changes (e.g. iteration count bump).
  const parts = passwordHash.split('$')
  const hashPart = parts.length >= 4 ? parts[parts.length - 1] : passwordHash
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(hashPart),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`hushare.pw.access.v1:${albumId}:${b}`))
  return toBase64(new Uint8Array(sig))
}

export async function verifyAccessToken(cookie: string, passwordHash: string, albumId: string): Promise<boolean> {
  if (!cookie) return false
  const now = currentTimeBucket()
  const [current, previous] = await Promise.all([
    deriveAccessToken(passwordHash, albumId, now),
    deriveAccessToken(passwordHash, albumId, now - 1),
  ])
  const cookieBytes = new TextEncoder().encode(cookie)
  // Always evaluate both comparisons and combine with bitwise OR — prevents any JIT
  // short-circuiting of the combination step after both values are already computed
  const matchCurrent = timingSafeEqualBytes(cookieBytes, new TextEncoder().encode(current))
  const matchPrevious = timingSafeEqualBytes(cookieBytes, new TextEncoder().encode(previous))
  return ((matchCurrent ? 1 : 0) | (matchPrevious ? 1 : 0)) !== 0
}

async function hmacPassword(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  pepper = passwordPeppers()[0],
): Promise<Uint8Array<ArrayBuffer>> {
  if (!pepper) throw new Error('No password pepper configured')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const message = new TextEncoder().encode(`${toBase64(salt)}:${password}`)
  const sig = await crypto.subtle.sign('HMAC', key, message)
  return new Uint8Array(sig)
}

function passwordPeppers(): string[] {
  const primary = process.env.ALBUM_PASSWORD_PEPPER
  if (!primary) {
    throw new Error(
      '[album-password] ALBUM_PASSWORD_PEPPER is required. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    )
  }
  const previous = process.env.ALBUM_PASSWORD_PEPPER_PREVIOUS
  return previous ? [primary, previous] : [primary]
}

async function pbkdf2(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

function toBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function timingSafeEqualBytes(a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBuffer>): boolean {
  // Branch-free: XOR lengths into r so unequal lengths always give r !== 0
  // without an early return that leaks expected length via timing.
  const len = Math.max(a.length, b.length)
  let r = a.length ^ b.length
  for (let i = 0; i < len; i++) r |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return r === 0
}

export const PASSWORD_COOKIE_PREFIX = 'hushare_pw_'
// 14 days: covers two 7-day token buckets with margin
export const PASSWORD_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 14

export function cookieNameForAlbum(albumId: string): string {
  return `${PASSWORD_COOKIE_PREFIX}${albumId}`
}
