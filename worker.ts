import { default as handler } from "./.open-next/worker.js";

// Minimal inline types — avoids importing @cloudflare/workers-types globally
// (that package conflicts with DOM types and is excluded from tsconfig)
interface ScheduledEvent {
  scheduledTime: number
  cron: string
  noRetry(): void
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

type Env = {
  ASSETS: { fetch(req: Request): Promise<Response> }
  R2_BUCKET: { delete(keys: string | string[]): Promise<void> }
  ALBUM_RETIREMENT_SECRET: string
  NEXT_PUBLIC_SITE_URL: string
}

// Must match the corresponding entries in wrangler.toml's crons list. A string that drifts from
// wrangler.toml does not fail anything — the branch simply never matches and the work silently
// stops running, which is why tests/architecture.test.ts asserts these two against that file.
const EVERY_MINUTE = '* * * * *'
const EVERY_3_HOURS = '0 */3 * * *'
const EVERY_DAY_AT_2 = '0 2 * * *'

async function callCronRoute(baseUrl: string, path: string, secret: string): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) {
      console.error(`[cron] ${path} responded ${res.status}: ${await res.text().catch(() => '')}`)
    }
  } catch (e) {
    console.error(`[cron] ${path} fetch failed:`, e instanceof Error ? e.message : String(e))
  }
}

const worker = {
  // NOTE: a worker-level `caches.default` HTML cache was removed here. It cached
  // marketing/home HTML in the colo cache, but the colo cache is NOT cleared on
  // deploy, so after a new build it kept serving stale HTML that referenced the
  // previous build's hashed JS chunks (now 404) — which broke client-only
  // components (e.g. the about-page globe) and hydration after every deploy.
  // If we want that latency win back, it must be re-introduced with a cache key
  // versioned by the build ID (so a new deploy can never serve old HTML), or via a
  // zone-level Cache Rule with purge-on-deploy — not an unversioned worker cache.
  fetch: (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> =>
    (handler as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }).fetch(request, env, ctx),

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const secret = env.ALBUM_RETIREMENT_SECRET
    if (!secret) {
      console.error('[cron] ALBUM_RETIREMENT_SECRET is not set — aborting scheduled run')
      return
    }
    const baseUrl = (env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space').replace(/\/+$/, '')

    // Two schedules share this handler, so branch on which one fired — otherwise adding the
    // every-minute bib sweep would also send renewal emails and retire albums 1440x a day.
    if (event.cron === EVERY_MINUTE) {
      // Bib indexing for race albums. Cheap no-op (one indexed query) when no album has it on.
      // This is the reliable path: the sweep kicked off by an upload gets cut short by the
      // post-response budget, so this is what actually carries an album to completion.
      ctx.waitUntil(Promise.all([
        callCronRoute(baseUrl, '/api/cron/bib-index', secret),
        // Presence rows are promised gone within 10 minutes of someone leaving, so the sweep has to
        // run on a clock rather than on the traffic it is cleaning up after.
        callCronRoute(baseUrl, '/api/cron/prune-data?mode=presence', secret),
        // Watches for a CLUSTER of real errors and emails once per hour at most. Cheap: one indexed
        // count, and it returns before touching anything else unless the threshold is crossed.
        callCronRoute(baseUrl, '/api/cron/error-alert', secret),
      ]))
      return
    }

    // RECLAIMING ABANDONED STREAM UPLOADS, EVERY THREE HOURS RATHER THAN ONCE A DAY.
    //
    // Cloudflare reserves maxDurationSeconds of account storage quota for every PENDING upload, and
    // has been observed not reclaiming abandoned ones for days past their own expiry. The quota is a
    // purchased ceiling and exhausting it does not cost more — it makes every video upload fail for
    // every album at once.
    //
    // The window this has to cover got wider when the per-clip length cap was removed: the longest
    // clip we now approve is the album's whole budget, so the largest single reservation went from
    // ~2.5 minutes to 16 (Free) / 31 (Pro) / 76 (Max), and the number of concurrent abandoned Max
    // uploads needed to exhaust 1,000 minutes fell from roughly 62 to roughly 13. A daily sweep
    // meant a worst-case reservation could sit for 24 hours; three-hourly bounds it to three.
    //
    // Safe to run often: it only deletes uploads whose own uploadExpiry has already passed, and it
    // skips anything queued, in progress or downloading — an upload in flight is never at risk.
    if (event.cron === EVERY_3_HOURS) {
      ctx.waitUntil(callCronRoute(baseUrl, '/api/cron/cleanup-stream', secret))
      return
    }

    // THE DAILY BATCH IS NAMED NOW, AND THE FALL-THROUGH IS CLOSED. It used to be the else-branch,
    // which cost twice over:
    //
    //   Deleting "0 2 * * *" from wrangler.toml passed the whole suite. Seven jobs stop forever and
    //   silently — including reconcile-subscriptions, whose absence drops a PAYING customer to free
    //   after the 7-day grace while Polar keeps charging them, and notify-expiry, which is the only
    //   warning before an album is retired. The cron test could not see it, because it compares the
    //   literals worker.ts NAMES and this batch had no literal to name.
    //
    //   And any schedule added to wrangler.toml without a branch here landed in this batch. A
    //   */5 * * * * entry would have sent renewal and expiry EMAILS TO CUSTOMERS 288 times a day.
    if (event.cron === EVERY_DAY_AT_2) {
      ctx.waitUntil(Promise.all([
      callCronRoute(baseUrl, '/api/cron/retire-albums', secret),
      callCronRoute(baseUrl, '/api/cron/notify-expiry', secret),
      callCronRoute(baseUrl, '/api/cron/notify-renewal', secret),
      callCronRoute(baseUrl, '/api/cron/package-renewal', secret),
      // Enforces the retention periods the privacy policy publishes: abuse logs and error reports
      // aged out at 30 days, and face collections deleted 90 days after an album's last upload.
      // Without this the policy's retention numbers are aspirations.
      callCronRoute(baseUrl, '/api/cron/prune-data', secret),
      // Asks Polar what every customer actually owns and writes it down. Entitlements come from
      // webhooks, and a webhook can simply never arrive — after which a paying customer silently
      // drops to free once the 7-day grace runs out, while Polar keeps charging them. This is the
      // safety net; a normal night changes nothing.
      callCronRoute(baseUrl, '/api/cron/reconcile-subscriptions', secret),
      // Same repair, for one-time package orders — see the route's own note.
      callCronRoute(baseUrl, '/api/cron/reconcile-packages', secret),
      ]))
      return
    }

    // AN UNRECOGNISED SCHEDULE DOES NOTHING, LOUDLY. Which way this errs is deliberate: a schedule
    // that runs nothing is caught by tests/architecture.test.ts before it can deploy, because that
    // test now requires every cron in wrangler.toml to have a branch here. A schedule that falls
    // through into the daily batch, by contrast, emails real customers on whatever cadence somebody
    // typed — and nothing would have caught it (rule 19).
    console.error('[cron] unrecognised schedule, nothing run:', event.cron)
  },
}

export default worker
