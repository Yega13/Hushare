import { getCloudflareContext } from '@opennextjs/cloudflare'

export async function broadcastAlbumSettings(
  albumId: string,
  payload: Record<string, unknown>,
): Promise<void> {
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
      body: JSON.stringify({
        messages: [{ topic: `album-settings-${albumId}`, event: 'album_settings', payload }],
      }),
      // Never let a slow/unreachable realtime endpoint hang: the broadcast is best-effort.
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn('[broadcast] HTTP', res.status, text.slice(0, 200))
    }
  } catch (e) {
    console.warn('[broadcast] album settings failed:', e instanceof Error ? e.message : String(e))
  }
}

// Fire the settings broadcast without blocking the response, while keeping it alive past the
// response via waitUntil. A plain fire-and-forget promise gets cancelled the moment the Worker
// returns, silently dropping the broadcast; awaiting it would add the round-trip to every
// mutation's latency. waitUntil gives reliable delivery at no cost to response time.
export function queueAlbumSettingsBroadcast(albumId: string, payload: Record<string, unknown>): void {
  const promise = broadcastAlbumSettings(albumId, payload)
  try {
    getCloudflareContext().ctx.waitUntil(promise)
  } catch {
    // Outside the Worker runtime (local dev/tests) there is no execution context — the promise
    // still runs to completion on its own; swallow its result so it stays fire-and-forget.
    void promise
  }
}
