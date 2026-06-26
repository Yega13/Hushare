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
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn('[broadcast] HTTP', res.status, text.slice(0, 200))
    }
  } catch (e) {
    console.warn('[broadcast] album settings failed:', e instanceof Error ? e.message : String(e))
  }
}
