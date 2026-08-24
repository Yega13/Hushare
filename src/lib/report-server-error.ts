import { createAdminClient } from '@/lib/supabase/admin'

// Server-side failures, recorded where someone will actually see them.
//
// Client errors have gone to error_events since the beginning; the server only ever called
// console.error, which writes to Cloudflare's log stream — retained briefly, not searchable
// alongside anything else, and in practice never read. Fifty-five route handlers log failures that
// way. So a guest could be handed a 500 by presign, the save route, or checkout, and /admin would
// show a clean panel: the one surface built to answer "is anything broken right now?" could not see
// half the system.
//
// Deliberately the SAME table as client reports rather than a second one. An incident usually
// crosses the boundary — a failing save shows up as both a server 500 and a client "save failed" —
// and two tables would mean correlating them by hand at exactly the moment nobody wants to.
//
// Never throws and never blocks the response. A failure to record a failure must not become one.
export function reportServerError(
  source: string,
  message: string,
  opts: { albumId?: string | null; context?: Record<string, unknown> } = {},
): void {
  try {
    const admin = createAdminClient()
    // Through the SAME coalescing the client path uses, not a raw insert.
    //
    // A raw insert reintroduced on the server exactly the problem coalescing was built to solve: a
    // broken presign during an event writes one row per failed request, unbounded, hammering the
    // database hardest at the worst possible moment and turning one incident into a hundred rows.
    // The RPC merges repeats within five minutes and counts them instead.
    void admin
      .rpc('coalesce_error_event', {
        p_level: 'error',
        p_source: `server:${source}`.slice(0, 60),
        p_message: String(message).slice(0, 500),
        p_album_id: opts.albumId ?? null,
        p_context: opts.context ?? {},
        p_ua: null,
      })
      .then(({ error }) => {
        if (!error) return
        console.error('[report-server-error] coalesce failed, inserting directly:', error.message)
        // Never lose a report because the coalescing failed.
        void admin.from('error_events').insert({
          level: 'error',
          source: `server:${source}`.slice(0, 60),
          message: String(message).slice(0, 500),
          album_id: opts.albumId ?? null,
          context: opts.context ?? null,
          ua: null,
        }).then(({ error: e2 }) => { if (e2) console.error('[report-server-error] insert failed:', e2.message) })
      })

  } catch (e) {
    console.error('[report-server-error] threw:', e instanceof Error ? e.message : String(e))
  }
}

// Convenience for the common shape: something threw, and we want the reason without the stack.
export function reportServerThrow(source: string, e: unknown, opts?: { albumId?: string | null; context?: Record<string, unknown> }): void {
  const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  reportServerError(source, message, opts)
}
