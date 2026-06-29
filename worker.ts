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

// `caches.default` is the Cloudflare colo edge cache (a Workers runtime global).
declare const caches: {
  default: {
    match(req: Request): Promise<Response | undefined>
    put(req: Request, res: Response): Promise<void>
  }
}

const worker = {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    const h = handler as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }

    // Edge-cache static, publicly-cacheable GET pages (home + marketing) in the
    // Cloudflare colo cache so repeat hits never invoke the Next worker. This is what
    // lets those pages scale under load: without it every request runs the worker and
    // the home page collapsed from 240→80 req/s at 150 concurrent. We only cache 200
    // GET responses the app explicitly marks `Cache-Control: public` with no Set-Cookie,
    // so all dynamic/album/API routes (which send `no-store`) and any authenticated
    // response are never cached.
    if (request.method === 'GET') {
      const cache = caches.default
      const hit = await cache.match(request)
      if (hit) return hit

      const response = await h.fetch(request, env, ctx)
      const cc = response.headers.get('cache-control') ?? ''
      if (response.status === 200 && cc.includes('public') && !response.headers.has('set-cookie')) {
        ctx.waitUntil(cache.put(request, response.clone()))
      }
      return response
    }

    return h.fetch(request, env, ctx)
  },

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
