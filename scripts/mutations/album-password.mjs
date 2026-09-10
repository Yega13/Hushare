// Mutation set for src/lib/album-password.ts -- run with:
//   node scripts/mutations/run.mjs album-password
//
// The gate on a private album, and the cookie that keeps a guest inside it. Every mutation here is
// either a stranger getting in, or a guest with the CORRECT password being turned away at a real
// event -- and the second is the worse failure, which is why the accept floor and the verify
// iteration floor both sit below what we would choose today.
export default {
  file: 'src/lib/album-password.ts',
  test: 'tests/album-password-policy.test.ts tests/access-control.test.ts tests/gates-and-money.test.ts',
  mutations: [
  // ── what may be SET, and what must still OPEN ────────────────────────────────────────────────
  { name: 'a new password may be as short as the accept floor, so a 4-digit PIN is set again',
    from: "  return hashPasswordAtLength(password, MIN_NEW_PASSWORD_LEN)", to: "  return hashPasswordAtLength(password, MIN_PASSWORD_LEN)" },
  { name: 'any length may be set, including empty',
    from: "  if (password.length < minLen || password.length > MAX_PASSWORD_LEN) {", to: "  if (false) {" },
  { name: 'THE VERIFY FLOOR IS RAISED TO THE SET FLOOR: eight live albums stop opening for their guests',
    from: "  if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) return false",
    to: "  if (password.length < MIN_NEW_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) return false" },
  { name: 'no length bound on verify, so a multi-megabyte string runs 100k PBKDF2 rounds on the Worker',
    from: "  if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) return false\n", to: "" },
  { name: 'the upper bound is dropped, so an attacker-sized password is still hashed',
    from: "  if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) return false",
    to: "  if (password.length < MIN_PASSWORD_LEN) return false" },

  // ── the stored hash ──────────────────────────────────────────────────────────────────────────
  { name: 'the salt is a constant, so identical passwords hash identically and one crack opens many',
    from: "  const salt = crypto.getRandomValues(new Uint8Array(16))", to: "  const salt = new Uint8Array(16)" },
  { name: 'the pepper is not mixed in, so an offline cracker needs only the database',
    from: "  const hash = await pbkdf2(`${pepper}:${password}`, salt, PBKDF2_ITERATIONS)",
    to: "  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS)" },
  { name: 'THE PASSWORD ITSELF IS STORED in the hash string',
    from: "  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`",
    to: "  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}$${password}`" },
  { name: 'the iteration count is a tenth of what it should be',
    from: "export const PBKDF2_ITERATIONS = 100_000", to: "export const PBKDF2_ITERATIONS = 10_000" },
  { name: 'a hash with one iteration is accepted, so a downgraded row verifies instantly',
    from: "  if (!Number.isFinite(iterations) || iterations < MIN_VERIFY_ITERATIONS) return false\n", to: "" },
  { name: 'a non-numeric iteration count is trusted',
    from: "  if (!Number.isFinite(iterations) || iterations < MIN_VERIFY_ITERATIONS) return false",
    to: "  if (iterations < MIN_VERIFY_ITERATIONS) return false" },

  // ── what a malformed stored hash does ────────────────────────────────────────────────────────
  { name: 'a hash with a fifth segment appended verifies as if the extra were not there',
    from: "  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false\n", to: "" },
  // NOT MUTATED -- dropping only the `parts[0] !== 'pbkdf2'` half is equivalent: every 4-segment
  // value that is not a pbkdf2 hash fails the iteration or base64 check below and returns false
  // anyway. The half that is load-bearing is the SEGMENT COUNT, mutated on its own above: without
  // it, a stored hash with anything appended verifies as if the extra were not there.
  { name: 'undecodable base64 throws out of verifyPassword rather than returning false',
    from: "    salt = fromBase64(parts[2])\n    expected = fromBase64(parts[3])\n  } catch {\n    return false\n  }",
    to: "    salt = fromBase64(parts[2])\n    expected = fromBase64(parts[3])\n  } catch {\n    throw new Error('bad hash')\n  }" },
  { name: 'the LEGACY branch throws on undecodable base64 instead of refusing',
    from: "      salt = fromBase64(parts[1])\n      expected = fromBase64(parts[2])\n    } catch {\n      return false\n    }",
    to: "      salt = fromBase64(parts[1])\n      expected = fromBase64(parts[2])\n    } catch {\n      throw new Error('bad hash')\n    }" },

  // ── the comparison ───────────────────────────────────────────────────────────────────────────
  { name: 'ANY PASSWORD OPENS ANY ALBUM',
    from: "    if (timingSafeEqualBytes(actual, expected)) matched = true\n  }\n  return matched\n}",
    to: "    if (timingSafeEqualBytes(actual, expected)) matched = true\n  }\n  return true\n}" },
  { name: 'the legacy comparison always matches',
    from: "      if (timingSafeEqualBytes(actual, expected)) matched = true\n    }\n    return matched",
    to: "      if (timingSafeEqualBytes(actual, expected)) matched = true\n    }\n    return true" },

  // ── the cookie that keeps a guest inside ─────────────────────────────────────────────────────
  { name: 'the token is not bound to the album, so one album cookie opens every other album',
    from: "sign('HMAC', key, new TextEncoder().encode(`hushare.pw.access.v1:${albumId}:${b}`))",
    to: "sign('HMAC', key, new TextEncoder().encode(`hushare.pw.access.v1:${b}`))" },
  { name: 'the token is not bound to the time bucket, so a stolen cookie never expires',
    from: "sign('HMAC', key, new TextEncoder().encode(`hushare.pw.access.v1:${albumId}:${b}`))",
    to: "sign('HMAC', key, new TextEncoder().encode(`hushare.pw.access.v1:${albumId}`))" },
  { name: 'the token is not keyed on the password hash, so changing the password evicts nobody',
    from: "  const hashPart = parts.length >= 4 ? parts[parts.length - 1] : passwordHash", to: "  const hashPart = 'hushare'" },
  // NOT MUTATED -- removing the empty-cookie guard is equivalent: an empty cookie encodes to zero
  // bytes and timingSafeEqualBytes rejects on a length difference before comparing anything, so
  // both derived tokens miss. The guard is worth keeping (it says so out loud, and skips two HMAC
  // derivations), but no input distinguishes it from its absence.
  { name: 'the previous bucket is not accepted, so guests are evicted mid-event every 7 days',
    from: "    deriveAccessToken(passwordHash, albumId, now - 1),", to: "    deriveAccessToken(passwordHash, albumId, now),"},
  { name: 'a bucket TWO windows old is still accepted, so a stolen cookie lasts three weeks',
    from: "    deriveAccessToken(passwordHash, albumId, now - 1),", to: "    deriveAccessToken(passwordHash, albumId, now - 2),"},
  { name: 'the cookie is not namespaced per album, so every album shares one',
    from: "  return `${PASSWORD_COOKIE_PREFIX}${albumId}`", to: "  return PASSWORD_COOKIE_PREFIX" },
  ],
}
