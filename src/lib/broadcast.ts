import { getCloudflareContext } from '@opennextjs/cloudflare'

// Supabase Realtime BROADCAST from the server (stateless HTTP endpoint). Broadcast scales where
// postgres_changes collapses under bursty fan-out (a load test showed postgres_changes dropped
// ~93% of INSERT events to 150 viewers; Broadcast delivered reliably). Used for two live signals:
//   - album SETTINGS changed  → topic `album-settings-<id>`, event `album_settings` (payload)
//   - album PHOTOS changed     → topic `album:<id>`, event `changed` (contentless; client refetches)
async function postBroadcast(topic: string, event: string, payload: Record<string, unknown>): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return
  try {
    const res = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        apikey: serviceRoleKey,
      },
      body: JSON.stringify({ messages: [{ topic, event, payload }] }),
      // Never let a slow/unreachable realtime endpoint hang: broadcasts are best-effort.
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn('[broadcast]', event, 'HTTP', res.status, text.slice(0, 200))
    }
  } catch (e) {
    console.warn('[broadcast]', event, 'failed:', e instanceof Error ? e.message : String(e))
  }
}

// Keep the broadcast alive PAST the response via waitUntil. A plain fire-and-forget promise gets
// cancelled the moment the Worker returns (silently dropping the broadcast — exactly what made an
// earlier attempt deliver 0 events); awaiting it would add the round-trip to every mutation's
// latency. waitUntil gives reliable delivery at no cost to response time.
function queue(promise: Promise<void>): void {
  try {
    getCloudflareContext().ctx.waitUntil(promise)
  } catch {
    // Outside the Worker runtime (local dev/tests) there is no execution context — the promise
    // still runs to completion on its own; swallow its result so it stays fire-and-forget.
    void promise
  }
}

export function queueAlbumSettingsBroadcast(albumId: string, payload: Record<string, unknown>): void {
  queue(postBroadcast(`album-settings-${albumId}`, 'album_settings', payload))
}

// Ping every viewer that this album's photos changed.
//
// `kind` exists so the client can avoid re-downloading the whole album for the common case.
//
//   'added'   — new uploads, and ONLY new uploads. Nothing existing moved or disappeared, so a
//               viewer can ask for just the rows newer than the ones it holds.
//   'changed' — a delete, a hide, or a reorder. These rewrite or remove rows the viewer already
//               has, and no "what is new" query can express that, so the viewer refetches.
//
// The split is worth having because the two are nothing alike in frequency: uploads are the bursty
// event (300 guests at a wedding), while deletes and reorders are one owner tapping occasionally.
//
// DEFAULTS TO THE SAFE ANSWER IN BOTH DIRECTIONS, which matters because a deploy leaves old clients
// talking to a new server and vice versa. An old client ignores the payload and refetches, as it
// always did. A new client that receives no `kind` treats it as 'changed' and refetches. Nobody
// ends up doing the cheap thing when the expensive thing was required.
export function queueAlbumChangedBroadcast(albumId: string, kind: 'added' | 'changed' = 'changed'): void {
  queue(postBroadcast(`album:${albumId}`, 'changed', { kind }))
}

// Run any best-effort async work past the response (e.g. notification emails) with the same
// waitUntil guarantee, so it isn't cancelled when the Worker returns.
export function runAfterResponse(promise: Promise<unknown>): void {
  try {
    getCloudflareContext().ctx.waitUntil(promise)
  } catch {
    void promise
  }
}
