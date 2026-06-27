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
  fetch: async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    const captured: string[] = []
    const origError = console.error.bind(console)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.error = (...args: any[]) => {
      captured.push(args.map((a: unknown) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '))
      origError(...args)
    }
    try {
      const response = await (handler as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }).fetch(request, env, ctx)
      if (response.status === 500) {
        const body = await response.clone().text()
        if (body.includes('Internal Server Error')) {
          return new Response(
            `[DEBUG 500]\n${captured.join('\n') || '(no console.error captured)'}`,
            { status: 500, headers: { 'content-type': 'text/plain' } },
          )
        }
      }
      return response
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.stack ?? e.message : String(e)
      origError('[worker] unhandled fetch error:', msg)
      return new Response(
        `[DEBUG throw]\n${msg}\n\n--- console.error ---\n${captured.join('\n') || '(none)'}`,
        { status: 500, headers: { 'content-type': 'text/plain' } },
      )
    } finally {
      console.error = origError
    }
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
