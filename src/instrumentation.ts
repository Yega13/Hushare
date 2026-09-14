// Next.js calls onRequestError for every error the server captures while rendering a page or running a
// route handler, and awaits it. Documented in node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/instrumentation.md; OpenNext's Cloudflare build loads this file through its
// patch-instrumentation plugin. What gets filed, and what does not, is lib/server/request-error.
//
// Imported inside the function and only on the Node.js runtime, as Next's instrumentation guide
// recommends for runtime-specific code: the reporter uses the Supabase admin client and the Cloudflare
// context, and every route in this app runs on Node.js.
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers?: unknown },
  context: { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') return
  const { reportRequestError } = await import('@/lib/server/request-error')
  reportRequestError(err, request, context)
}
