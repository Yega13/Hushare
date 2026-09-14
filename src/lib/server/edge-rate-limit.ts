import { getCloudflareContext } from '@opennextjs/cloudflare'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

// RATE LIMITS FOR THE READS A GUEST WAITS ON, COUNTED AT THE EDGE INSTEAD OF IN POSTGRES.
//
// The review of 2026-09-14 measured every database call from the Worker at 350 ms to 1 second, and
// found the busiest reads paying one of those calls for rate limiting BEFORE doing any work: the
// album's photo read (which is also the every-refresh freshness check), the album resolve, and the
// presence heartbeat. All three were already fail-open -- a limiter blip never refuses them -- so the
// database counter bought exactness these routes never needed, at the price of a round trip on the
// hottest paths in the product.
//
// Cloudflare's rate limiting binding adds no meaningful latency. Its trade, from the docs: counts are
// per Cloudflare location and eventually consistent, "intentionally designed to not be used as an
// accurate accounting system", and the period can only be 10 or 60 seconds. For a runaway-loop
// backstop on a read of an album the caller can already open, that is the right tool.
//
// THE NUMBERS LIVE HERE AND IN wrangler.toml, and tests/edge-rate-limit-config holds them equal,
// production and staging (rule 13: a binding cannot import a module).

type RateLimitBinding = { limit(opts: { key: string }): Promise<{ success: boolean }> }
type Verdict = { ok: true } | { ok: false; retryAfterSeconds: number }

/** The only window the binding offers that fits these routes' old per-minute limits. */
export const READ_LIMIT_PERIOD_SECONDS = 60

export const READ_LIMITS = {
  // Sized for a venue: one public IP shared by every guest on the WiFi (see api/album/photos).
  albumPhotos: { binding: 'ALBUM_PHOTOS_LIMITER', prefix: 'album_photos', perMinute: 20000 },
  albumResolve: { binding: 'ALBUM_RESOLVE_LIMITER', prefix: 'album_resolve', perMinute: 900 },
  presence: { binding: 'PRESENCE_LIMITER', prefix: 'presence', perMinute: 3000 },
} as const

export type ReadLimitName = keyof typeof READ_LIMITS

type Deps = {
  env: () => Record<string, unknown> | undefined
  fallback: typeof checkRateLimit
}

const defaultDeps: Deps = {
  env: () => getCloudflareContext()?.env as Record<string, unknown> | undefined,
  fallback: checkRateLimit,
}

/**
 * The verdict for one read, keyed by the caller's IP exactly as the Postgres limiter keyed it.
 *
 * WITH THE BINDING: one local counter, and a limiter error lets the request through, as these routes
 * always did.
 * WITHOUT IT (local development, a test, or a deploy missing the binding): the Postgres limiter, so a
 * configuration gap costs a round trip but never removes the protection.
 */
export async function readRateLimit(req: Request, which: ReadLimitName, deps: Deps = defaultDeps): Promise<Verdict> {
  const spec = READ_LIMITS[which]
  const key = clientIpKey(req, spec.prefix)

  let binding: RateLimitBinding | undefined
  try {
    const candidate = deps.env()?.[spec.binding] as RateLimitBinding | undefined
    binding = typeof candidate?.limit === 'function' ? candidate : undefined
  } catch {
    // getCloudflareContext throws outside a Workers request; that is the no-binding case.
    binding = undefined
  }

  if (binding) {
    try {
      const { success } = await binding.limit({ key })
      return success ? { ok: true } : { ok: false, retryAfterSeconds: READ_LIMIT_PERIOD_SECONDS }
    } catch {
      return { ok: true }
    }
  }

  return deps.fallback(key, READ_LIMIT_PERIOD_SECONDS, spec.perMinute, { failOpen: true })
}
