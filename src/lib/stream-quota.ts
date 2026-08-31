// IS THE CLOUDFLARE STREAM STORAGE QUOTA ABOUT TO RUN OUT?
//
// `totalStorageMinutesLimit` is not a spend meter. Stream storage is BOUGHT, in units of 1,000
// minutes for $5/month, and the limit is how much has been purchased. Reaching it does not cost
// more — it makes every video upload FAIL, for every album, everywhere. This codebase already
// records that happening once: six abandoned uploads reserving quota "exhausted the whole
// account's 1000-min quota and blocked ALL video uploads."
//
// So this is the one usage number on the admin page where running out is an OUTAGE rather than an
// invoice, and it is the one nobody would think to check. The fix when it fires is trivial — buy
// another $5 unit — which is exactly why it must be seen early rather than discovered by a guest
// at an event whose video will not upload.
//
// The thresholds are deliberately early. Raising capacity takes a moment in a dashboard, and the
// cost of being told too soon is a line on a page; the cost of being told too late is video being
// broken during somebody's wedding.

export type StreamQuotaLevel = 'ok' | 'watch' | 'critical'

/** Fraction of purchased Stream storage in use, or null when the limit is unknown. */
export function streamQuotaUsed(minutes: number, limit: number): number | null {
  if (!Number.isFinite(minutes) || !Number.isFinite(limit) || limit <= 0) return null
  return minutes / limit
}

export function streamQuotaLevel(minutes: number, limit: number): StreamQuotaLevel {
  const used = streamQuotaUsed(minutes, limit)
  // An unknown limit is NOT an alarm. Cloudflare reports 0 for accounts on plans where this does
  // not apply, and crying wolf on a number we do not understand teaches people to ignore the card.
  if (used === null) return 'ok'
  if (used >= 0.85) return 'critical'
  if (used >= 0.6) return 'watch'
  return 'ok'
}

/** How many more $5 units of 1,000 minutes would be needed to hold `minutes` with room to spare. */
export const STREAM_UNIT_MINUTES = 1000
export const STREAM_UNIT_USD = 5

export function streamUnitsNeeded(minutes: number, headroom = 1.5): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 1
  return Math.max(1, Math.ceil((minutes * headroom) / STREAM_UNIT_MINUTES))
}
