// WHO THE ERROR ALERT IS ABOUT, not just how many errors there were.
//
// The alert said "23 things failed for guests in the last 10 minutes" and stopped there. That is
// enough to know something is wrong and useless for doing anything about it: the reader cannot tell
// whether it is one album melting down or twenty guests each hitting one blip, cannot open the
// album, and cannot contact whoever it is happening to. Every alert therefore ended the same way —
// open /admin, sort it out by hand, at whatever hour it arrived.
//
// The rows already carry album_id. The cron simply never selected it.
//
// ONE definition of "how many times did this go wrong", shared by every tally here. The route used
// to keep its own copy inline, and the whole alarm had already been disarmed once by exactly that
// kind of drift: rows were counted instead of repeats, so one message failing a hundred times in
// one album — the incident this exists to catch — counted as two.

export type ErrorAlertRow = {
  album_id?: string | null
  message?: string | null
  context?: { repeats?: number } | null
}

/**
 * How many real failures one row represents.
 *
 * api/log/client-error merges a repeat of the same (level, source, message, album) into the
 * existing row within five minutes and increments context.repeats, so a row is a GROUP of
 * failures, not one. Anything missing or nonsensical counts as the single failure the row
 * definitely represents — never zero, which would let a malformed context hide an incident.
 */
export function occurrencesOf(row: ErrorAlertRow): number {
  const n = row.context?.repeats
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 1
}

/** Total failures across every row. */
export function totalOccurrences(rows: ErrorAlertRow[]): number {
  return rows.reduce((n, r) => n + occurrencesOf(r), 0)
}

export type AlbumTally = { albumId: string; count: number }

/**
 * Which albums are actually affected, worst first.
 *
 * Rows with no album_id are deliberately dropped rather than bucketed under "unknown": they are
 * failures on pages that belong to no album (pricing, account, the home page), and listing them
 * beside real albums under a heading that invites you to go and look would be noise in the one
 * place the alert is trying to be specific. The overall COUNT still includes them, so the
 * headline number never shrinks — the reader is told about them by the difference, not misled.
 *
 * `max` bounds the email, not the truth: `moreAlbums` reports how many were left out, because
 * "3 albums" and "3 albums plus 19 more" are very different mornings.
 */
export function tallyByAlbum(rows: ErrorAlertRow[], max = 5): { albums: AlbumTally[]; moreAlbums: number } {
  const byAlbum = new Map<string, number>()
  for (const r of rows) {
    const id = r.album_id
    if (!id) continue
    byAlbum.set(id, (byAlbum.get(id) ?? 0) + occurrencesOf(r))
  }
  const sorted = [...byAlbum.entries()]
    .map(([albumId, count]) => ({ albumId, count }))
    .sort((a, b) => b.count - a.count || a.albumId.localeCompare(b.albumId))
  return { albums: sorted.slice(0, max), moreAlbums: Math.max(0, sorted.length - max) }
}

/** The dominating messages, weighted by repeats the same way. */
export function tallyByMessage(rows: ErrorAlertRow[], max = 5): [string, number][] {
  const byMessage = new Map<string, number>()
  for (const r of rows) {
    const m = r.message
    if (!m) continue
    byMessage.set(m, (byMessage.get(m) ?? 0) + occurrencesOf(r))
  }
  return [...byMessage.entries()].sort((a, b) => b[1] - a[1]).slice(0, max)
}
