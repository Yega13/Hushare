import { createAdminClient } from '@/lib/supabase/admin'

type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number }

export async function checkRateLimit(
  key: string,
  windowSeconds: number,
  maxRequests: number,
  options?: { failOpen?: boolean },
): Promise<RateLimitResult> {
  const failOpen = options?.failOpen ?? false
  try {
    const admin = createAdminClient()
    const since = new Date(Date.now() - windowSeconds * 1000).toISOString()

    // Optimistic-insert pattern: record the event FIRST, then verify the total count.
    // The old count-then-insert had a TOCTOU window where two concurrent requests could
    // both read N < max, both insert, and both slip through. With insert-first, the count
    // reflects the true post-insert total; if over the limit we delete our row and deny.
    // Under concurrent load this may be more conservative (denying a burst that just fits),
    // but it never allows more than maxRequests — the safe failure direction for a limiter.
    const { data: inserted, error: insertError } = await admin
      .from('rate_limit_events')
      .insert({ key })
      .select('id')
      .single()

    if (insertError) {
      if (/does not exist/i.test(insertError.message ?? '')) {
        console.warn('[rate-limit] rate_limit_events table missing — rate limit not enforced')
        return failOpen ? { ok: true } : { ok: false, retryAfterSeconds: 60 }
      }
      console.warn('[rate-limit] insert failed:', insertError.message)
      return failOpen ? { ok: true } : { ok: false, retryAfterSeconds: 30 }
    }

    const { count, error: countError } = await admin
      .from('rate_limit_events')
      .select('id', { count: 'exact', head: true })
      .eq('key', key)
      .gte('created_at', since)

    if (countError) {
      console.warn('[rate-limit] count failed:', countError.message)
      // Clean up the insert before returning so we don't inflate the count permanently.
      // Log on failure — ghost rows accumulate and can cause permanent lockout if left.
      const { error: delErr } = await admin.from('rate_limit_events').delete().eq('id', inserted.id)
      if (delErr) console.error('[rate-limit] cleanup delete failed — ghost row may inflate future counts:', delErr.message)
      return failOpen ? { ok: true } : { ok: false, retryAfterSeconds: 60 }
    }

    // count includes our just-inserted row, so the threshold is > (not >=)
    if (count != null && count > maxRequests) {
      const { error: delErr } = await admin.from('rate_limit_events').delete().eq('id', inserted.id)
      if (delErr) console.error('[rate-limit] reject-delete failed — ghost row may inflate future counts:', delErr.message)
      return { ok: false, retryAfterSeconds: windowSeconds }
    }

    // Probabilistic cleanup (1% of calls) — scoped to this key so we don't wipe events
    // for other keys that may have longer windows still within their active period.
    if (Math.random() < 0.01) {
      void admin.from('rate_limit_events').delete().eq('key', key).lt('created_at', since)
    }

    return { ok: true }
  } catch (err) {
    console.error('[rate-limit] unexpected error:', err, 'failOpen:', failOpen)
    return failOpen ? { ok: true } : { ok: false, retryAfterSeconds: 60 }
  }
}

export function clientIpKey(req: Request, prefix: string): string {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return `${prefix}:${cf.trim().slice(0, 64)}`

  // In production all traffic must flow through Cloudflare (orange-cloud on), which always
  // sets cf-connecting-ip. Reaching this fallback in production means the origin is directly
  // reachable and x-forwarded-for is client-controlled and trivially spoofable.
  // Log a warning so this misconfiguration is visible in production logs.
  if (process.env.NODE_ENV === 'production') {
    console.warn('[rate-limit] cf-connecting-ip missing in production — origin may be directly reachable; XFF fallback is spoofable')
  }

  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    // Take the LAST entry — that's the one added by our own infra and cannot be spoofed by the client.
    // The first entry is always client-controlled and trivially spoofable.
    const parts = xff.split(',')
    const ip = parts[parts.length - 1].trim()
    // Normalize IPv6 bracket notation (e.g. [::1]:12345 → ::1)
    const clean = ip.replace(/^\[(.+)\](?::\d+)?$/, '$1').slice(0, 64)
    if (clean) return `${prefix}:${clean}`
  }

  // Both cf-connecting-ip and x-forwarded-for are absent. All requests will share one
  // rate-limit bucket, so the limit becomes per-server, not per-IP. This is safe in a
  // dev environment but is a critical misconfiguration in production.
  if (process.env.NODE_ENV === 'production') {
    console.error('[rate-limit] CRITICAL: no IP header available — all requests share one bucket for key prefix:', prefix)
  }
  return `${prefix}:unknown`
}
