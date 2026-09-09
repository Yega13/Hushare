// THE OWNER LINK: the token in the URL fragment, and what the owner-login answer means.
//
// The owner's management link is the album URL with #owner=<token>. The fragment never reaches
// a server, so the client reads it -- and read it in three places, three ways (rule 13). One
// reader now. And the owner-login call's verdict was an inline loop: a single network blip used
// to drop the owner to guest view ("sometimes owner, sometimes guest"), so a TRANSIENT failure is
// retried once, while a definitive refusal -- wrong token, album gone -- is not.

/** The owner token in a location hash (with or without its leading '#'), or null. */
export function ownerTokenFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const token = new URLSearchParams(raw).get('owner')
  return token ? token : null
}

export type OwnerLoginVerdict = 'owner' | 'not-owner' | 'retry'

/**
 * What one owner-login answer means. 2xx proves ownership (the server verified the token
 * against this album). 403 and 404 are definitive: wrong token, or no such album. Anything else
 * -- 429, a 5xx, a gateway timeout -- is the network's problem, and worth one more try.
 */
export function ownerLoginVerdict(status: number, ok: boolean): OwnerLoginVerdict {
  if (ok) return 'owner'
  if (status === 403 || status === 404) return 'not-owner'
  return 'retry'
}

export const OWNER_LOGIN_ATTEMPTS = 2
export const OWNER_LOGIN_RETRY_DELAY_MS = 600
export const OWNER_LOGIN_ATTEMPT_TIMEOUT_MS = 10_000

/**
 * Asks the server until it gives a definitive answer or the attempts run out. `post` is the one
 * request (given a signal it must honour); a thrown error -- network, or the per-attempt timeout
 * -- counts as a transient failure. Returns whether ownership was proven.
 */
export async function verifyOwnerToken(
  post: (signal: AbortSignal) => Promise<{ ok: boolean; status: number }>,
  opts: { attempts?: number; retryDelayMs?: number; attemptTimeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? OWNER_LOGIN_ATTEMPTS
  const retryDelayMs = opts.retryDelayMs ?? OWNER_LOGIN_RETRY_DELAY_MS
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? OWNER_LOGIN_ATTEMPT_TIMEOUT_MS
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let attempt = 0; attempt < attempts; attempt++) {
    const ac = new AbortController()
    const timeoutId = setTimeout(() => ac.abort(), attemptTimeoutMs)
    let verdict: OwnerLoginVerdict = 'retry'
    try {
      const res = await post(ac.signal)
      verdict = ownerLoginVerdict(res.status, res.ok)
    } catch {
      verdict = 'retry'
    } finally {
      clearTimeout(timeoutId)
    }
    if (verdict === 'owner') return true
    if (verdict === 'not-owner') return false
    if (attempt < attempts - 1) await sleep(retryDelayMs)
  }
  return false
}
