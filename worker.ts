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
  fetch: (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> =>
    (handler as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }).fetch(request, env, ctx),

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const secret = env.ALBUM_RETIREMENT_SECRET
    if (!secret) {
      console.error('[cron] ALBUM_RETIREMENT_SECRET is not set — aborting scheduled run')
      return
    }
    const baseUrl = (env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space').replace(/\/+$/, '')
    ctx.waitUntil(Promise.all([
      callCronRoute(baseUrl, '/api/cron/retire-albums', secret),
      callCronRoute(baseUrl, '/api/cron/notify-expiry', secret),
      callCronRoute(baseUrl, '/api/cron/notify-renewal', secret),
    ]))
  },
}

export default worker
