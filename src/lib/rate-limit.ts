import { createAdminClient } from '@/lib/supabase/admin'

type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number }

// ONE ROUND TRIP, via a counter row that is incremented and judged in a single statement.
//
// The old path cost two HTTPS round trips to Supabase per check (insert a row, then count the
// rows) and a third on rejection (delete the row it just inserted) — and there are FOUR checks on
// the upload path, so an event spent tens of thousands of round trips on rate limiting alone. The
// database work was never the problem: the count is an Index Only Scan at 1.8ms, measured. The cost
// was the network, and no index or query tuning reaches that.
//
// public.rate_limit_hit() increments the counter and returns the verdict in one statement, so the
// check-then-act race the insert-first pattern was built to avoid cannot happen — proved against
// the live database with 1,000 genuinely parallel calls against a limit of 900: exactly 900
// admitted, every call counted, zero errors.
//
// It also stops the table growing: one row per key per window instead of one per request.
// rate_limit_events peaked at 62,846 rows.
//
// THE TRADE, and it is a real one. A counter is a FIXED window (hits in this N-second block) where
// the old one was SLIDING (events in the last N seconds), so up to 2x the limit can pass across a
// boundary. For an abuse backstop that is the normal trade. It is NOT acceptable where max is tiny
// and the limiter is really a DEBOUNCE — photo_notify allows 1 per 600s to send the owner one "new
// photos" email, and a fixed window could send two. Those callers pass `sliding: true` and keep the
// old implementation, which is why it is still here rather than deleted.
export async function checkRateLimit(
  key: string,
  windowSeconds: number,
  maxRequests: number,
  options?: { failOpen?: boolean; sliding?: boolean },
): Promise<RateLimitResult> {
  const failOpen = options?.failOpen ?? false
  if (!options?.sliding) {
    try {
      const admin = createAdminClient()
      const { data, error } = await admin
        .rpc('rate_limit_hit', { p_key: key, p_window_seconds: windowSeconds, p_max: maxRequests })
        .single<{ allowed: boolean; retry_after: number }>()
      if (error) {
        // Fall through to the sliding implementation rather than failing the request: a limiter
        // that breaks the product it protects is worse than one that costs an extra round trip.
        console.warn('[rate-limit] rate_limit_hit failed, falling back:', error.message)
      } else if (data) {
        return data.allowed
          ? { ok: true }
          : { ok: false, retryAfterSeconds: Math.max(1, data.retry_after) }
      }
    } catch (err) {
      console.warn('[rate-limit] rate_limit_hit threw, falling back:', err instanceof Error ? err.message : String(err))
    }
  }

  // ── Sliding-window implementation. Still the path for debounce-shaped callers, and the fallback
  //    if the counter RPC is unavailable (e.g. mid-migration, before the function exists).
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

// AN IPv6 CLIENT IS A WHOLE NETWORK, NOT AN ADDRESS.
//
// Every per-IP limit in the product keyed on the full address. A routed /64 is standard on almost
// any VPS, which gives one host 18 quintillion distinct addresses — so every limit keyed this way
// (presign, face search, password attempts, album creation) was effectively per-request for anyone
// who wanted around it, while still binding real visitors. Keying on the /64 makes an IPv6 client
// cost the same as an IPv4 one.
//
// A /64 is also the smallest block a residential customer is normally assigned, so this does not
// merge separate households into one bucket — and the venue case the limits are sized for (a room
// sharing one address) is unchanged.
export function ipBucket(raw: string): string {
  const ip = raw.trim().slice(0, 64)
  if (!ip.includes(':')) return ip
  // Expand only as far as needed to take the first four groups; a '::' anywhere after them means
  // the rest is zeros, and anything before is already explicit.
  const [head] = ip.split('%')            // strip any zone index (fe80::1%eth0)
  const groups = head.split(':')
  const out: string[] = []
  for (const g of groups) {
    if (out.length === 4) break
    if (g === '') { while (out.length < 4) out.push('0'); break }
    out.push(g)
  }
  while (out.length < 4) out.push('0')
  return out.join(':') + '::/64'
}

export function clientIpKey(req: Request, prefix: string): string {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return `${prefix}:${ipBucket(cf)}`

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
    if (clean) return `${prefix}:${ipBucket(clean)}`
  }

  // Both cf-connecting-ip and x-forwarded-for are absent. All requests will share one
  // rate-limit bucket, so the limit becomes per-server, not per-IP. This is safe in a
  // dev environment but is a critical misconfiguration in production.
  if (process.env.NODE_ENV === 'production') {
    console.error('[rate-limit] CRITICAL: no IP header available — all requests share one bucket for key prefix:', prefix)
  }
  return `${prefix}:unknown`
}
