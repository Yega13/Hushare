import { reportServerError } from '@/lib/report-server-error'
import type { Json } from '@/types/database'

// WHAT THE SERVER HIT WHILE ANSWERING A REQUEST, WHERE SOMEONE WILL SEE IT.
//
// Found 2026-09-14 from three panel rows nobody could act on: "Minified React error #419" on the home
// page, from two iPhones and an Android. React's own source names it -- "The server could not finish
// this Suspense boundary, likely due to an error during server rendering. Switched to client
// rendering." The browser recovered and the visitor saw a page, so the only trace was that sentence.
// The actual server error was written to console.error, which on this deployment nobody reads
// (observability is off), and nothing in the repository used Next's onRequestError hook to send it
// anywhere else. Every server render error and every uncaught throw in a route handler was invisible.
//
// src/instrumentation.ts hands each one here. The row carries the digest, and the browser's #419 row
// carries the same digest (lib/report-error), so the two sides of one incident can be matched.

export type RequestInfo = { path: string; method: string }
export type RequestErrorContext = { routePath?: string; routeType?: string; renderSource?: string }
export type DescribedRequestError = { source: string; message: string; context: Record<string, Json> }

/**
 * Next's own control flow, thrown on purpose and caught by Next: redirect(), notFound(), a bailout to
 * client rendering, a dynamic API used during prerendering. On the page-render path Next filters these
 * before calling the hook (server/app-render/create-error-handler.js). On the route-handler path it
 * reports every throw except NoFallbackError (build/templates/app-route.js), so they are dropped here.
 */
export const CONTROL_FLOW_DIGESTS: readonly string[] = [
  'NEXT_REDIRECT',
  'NEXT_HTTP_ERROR_FALLBACK',
  'BAILOUT_TO_CLIENT_SIDE_RENDERING',
  'DYNAMIC_SERVER_USAGE',
  'NEXT_PRERENDER_INTERRUPTED',
  'HANGING_PROMISE_REJECTION',
]

const NEWLINE = String.fromCharCode(10)

/** The row for one server error, or null when it is Next's control flow rather than a failure. */
export function describeRequestError(err: unknown, request: RequestInfo, context: RequestErrorContext): DescribedRequestError | null {
  const rawDigest = (err as { digest?: unknown } | null | undefined)?.digest
  const digest = typeof rawDigest === 'string' ? rawDigest : null
  if (digest && CONTROL_FLOW_DIGESTS.some((d) => digest.startsWith(d))) return null

  // THE QUERY STRING IS DROPPED. request.path is the raw URL, and a query can carry a token or an id
  // that has no business in an error table. Owner tokens live in the fragment, which a browser never
  // sends -- stripped anyway, in case one ever arrives some other way.
  const path = String(request.path ?? '').split('?')[0].split('#')[0]
  const described: Record<string, Json> = { path, method: request.method || 'GET' }
  if (digest) described.digest = digest.slice(0, 100)
  if (context.renderSource) described.renderSource = context.renderSource
  if (err instanceof Error && err.stack) {
    described.stack = err.stack.split(NEWLINE).slice(1, 6).map((line) => line.trim()).join(' | ').slice(0, 600)
  }
  return {
    source: `${context.routeType || 'request'}:${context.routePath || path}`,
    message: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    context: described,
  }
}

/** Files the row through the same coalescing every other server failure uses. Never throws. */
export function reportRequestError(
  err: unknown,
  request: RequestInfo,
  context: RequestErrorContext,
  report: typeof reportServerError = reportServerError,
): void {
  try {
    const described = describeRequestError(err, request, context)
    if (described) report(described.source, described.message, { context: described.context })
  } catch (e) {
    console.error('[request-error] could not describe a request error:', e instanceof Error ? e.message : String(e))
  }
}
