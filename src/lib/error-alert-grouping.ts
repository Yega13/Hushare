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
 * The most one row may claim to represent.
 *
 * context.repeats IS ATTACKER-WRITTEN. api/log/client-error accepts any small object as `context`
 * and the canonical insert stores it verbatim, and its only protection is an Origin header, which
 * a browser cannot forge and curl sets for free. So one unauthenticated request —
 *
 *     POST /api/log/client-error
 *     Origin: https://hushare.space
 *     {"source":"x","message":"y","level":"error","context":{"repeats":100000}}
 *
 * — used to clear the threshold of 8 on its own, fire the alert, and CLAIM THE 60-MINUTE COOLDOWN,
 * so every real incident in the following hour returned "cooldown" and was never sent. Repeat
 * hourly and the alarm is permanently occupied. Not a regression — the inline counting this
 * replaced read the same field — but making it the one load-bearing input is the moment to bound it.
 *
 * 1,000 is far above any honest row (the coalescing window is five minutes) and far below a number
 * that can drown the tally. A capped row still counts as a big row, so a genuine storm is not
 * hidden by the cap; it just cannot be manufactured from one request.
 */
export const MAX_REPEATS_PER_ROW = 1000

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
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return 1
  return Math.min(Math.floor(n), MAX_REPEATS_PER_ROW)
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

/**
 * The dominating messages, weighted by repeats the same way.
 *
 * TIED MESSAGES ARE BROKEN BY NAME, and that matters more here than in tallyByAlbum, which has had
 * the same tiebreak from the start. The FIRST entry of this list becomes the incident's SIGNATURE,
 * and the signature is what the same-incident rule compares against.
 *
 * Without a tiebreak the order of two equal-weight messages is the order their rows arrived, and
 * rows arrive newest-first — so one network drop that produces Safari's "Failed to fetch" and
 * "Load failed" in equal number flips the signature from tick to tick. Each flip looks like a NEW
 * incident, so the alarm sends again, and again, until it hits the hourly ceiling — after which it
 * is silent for the rest of the hour. Four emails about one problem, then nothing during it.
 */
export function tallyByMessage(rows: ErrorAlertRow[], max = 5): [string, number][] {
  const byMessage = new Map<string, number>()
  for (const r of rows) {
    const m = r.message
    if (!m) continue
    byMessage.set(m, (byMessage.get(m) ?? 0) + occurrencesOf(r))
  }
  return [...byMessage.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
}

// ── WHETHER TO SEND AT ALL ───────────────────────────────────────────────────────────────────
//
// These four numbers lived in the cron route, where nothing could import them and nothing could
// test them. Twelve mutations to that handler passed the whole suite, including setting the
// threshold to 100000 — after which the alarm can never fire again — and deleting the cooldown
// claim, after which it fires every minute for the length of an incident.
export const WINDOW_MINUTES = 10
/** Must match the coalescing window in api/log/client-error. */
export const COALESCE_WINDOW_MINUTES = 5
/**
 * THE WINDOW ACTUALLY LOOKED AT, and therefore the only one the email may name.
 *
 * The cron widens its query by the coalescing window, because a row that is absorbing repeats keeps
 * its ORIGINAL created_at and can sit just outside ten minutes while being the thing going wrong
 * right now. That widening was correct and invisible: the query measured fifteen minutes and the
 * email said ten, in the subject line and the first sentence, so the operator was told a number
 * nobody had computed. The threshold is likewise "8 in fifteen minutes", not eight in ten.
 *
 * One fact, one place — the route derives its `since` from this and hands this to the email, so the
 * two cannot disagree again (rule 13).
 */
export const ALERT_WINDOW_MINUTES = WINDOW_MINUTES + COALESCE_WINDOW_MINUTES
export const THRESHOLD = 8
export const COOLDOWN_MINUTES = 60
/**
 * The most alerts that may be sent in any rolling hour, whatever their signature.
 *
 * The floor under the signature rule below. Four is chosen so a poisoner cannot make the inbox
 * unreadable while a genuine bad morning — several unrelated failures — still gets through. It is
 * the difference between an alarm that can be drowned and one that can only be made noisier.
 */
export const MAX_ALERTS_PER_HOUR = 4

/** What the last alert recorded, as stored in system_state.value. */
export type AlertState = {
  sentAt?: string
  /** The dominating message when that alert was sent — the incident's fingerprint. */
  signature?: string
  hourStart?: string
  sentThisHour?: number
}

export type AlertVerdict =
  | { send: false; reason: 'below-threshold' | 'same-incident' | 'hourly-cap' }
  | { send: true; nextState: AlertState }

/**
 * Read whatever is in system_state.value, including what the OLD version wrote.
 *
 * Before this, the column held a bare ISO timestamp. A deploy must not treat that as "no previous
 * alert" and immediately fire — nor throw. An unparseable value means "we do not know when the last
 * one went", and the safe reading of that is to allow a send: silence is the failure that matters.
 */
export function parseAlertState(raw: string | null | undefined): AlertState | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as AlertState
      return typeof parsed === 'object' && parsed !== null ? parsed : null
    } catch { return null }
  }
  // The legacy shape: a bare timestamp, no signature. Treated as an incident whose fingerprint we
  // do not know, so the signature rule cannot suppress on it.
  return Number.isFinite(Date.parse(trimmed)) ? { sentAt: trimmed } : null
}

/**
 * Should this tick send an alert?
 *
 * COOLDOWN BY INCIDENT, NOT BY CLOCK — and the reason is not the attacker.
 *
 * A flat hourly cooldown drops a genuine SECOND incident. Different failure, different album, same
 * hour: today it returns "cooldown" and is never sent, with nobody attacking anything. That is a
 * real product defect and it is the reason to change this.
 *
 * It also narrows an attack that was twice claimed fixed and was not: capping context.repeats at
 * 1000 does nothing when the threshold is 8. Eight posts with eight distinct messages reach it with
 * nothing to cap, fire the alert, and burn the whole hour for every real incident behind them.
 *
 * MAX_ALERTS_PER_HOUR is the floor under that, so the same trick cannot turn the alarm into a
 * flood instead.
 *
 * WHAT THIS DOES NOT DO. Two residuals, both open, both with a test below that fails if either is
 * ever actually closed — because a comment is the cheapest thing in this file to get wrong, and this
 * paragraph has now been wrong twice (MISTAKES entries 11 and 16).
 *
 * FIRST: it does not guarantee "never silence". The hourly ceiling applies to every signature and is
 * checked BEFORE the signature rule, so four unauthenticated POSTs with four different messages send
 * four alerts, spend the hour, and a genuine incident behind them is refused with 'hourly-cap' until
 * the hour turns. One request used to buy sixty minutes; four now buy about fifty-six, and the
 * operator at least gets four emails saying something is happening.
 *
 * SECOND, AND WORSE — this is the sentence that used to be here and was FALSE: "keying the
 * suppression to the dominating message means a poisoner can only silence the incident they are
 * themselves manufacturing." It does not. The suppression is on the TICK, not on the incident:
 * alertVerdict returns send:false for the whole run, and the signature is whichever message
 * dominates tallyByMessage — which an attacker chooses. Three things compound:
 *
 *   * `source` is attacker-supplied free text (60 chars) and is part of api/log/client-error's
 *     coalescing key, so N distinct sources are N distinct rows;
 *   * MAX_REPEATS_PER_ROW caps a ROW, while tallyByMessage SUMS across rows — so the cap on one row
 *     is not a cap on one message;
 *   * the cron samples 200 rows newest-first, so fresh attacker rows evict the genuine incident from
 *     the sample entirely — it is not even in the top-5 list or the album block.
 *
 * ~1,340 requests an hour from a single IP therefore pin the signature to a message the attacker
 * wrote and suppress every real incident indefinitely, while the operator keeps receiving one
 * plausible-looking email an hour — which reads as the alarm working. That is worse than the first
 * residual in every dimension: sustainable, cheap, and it does not even spend the hourly ceiling.
 *
 * Closing it needs a change of behaviour, not a comment: requiring corroboration from several
 * distinct sources and albums before a signature may suppress, capping each source's contribution to
 * a message, or authenticating the endpoint. Each is a product decision, so this says what is true
 * and leaves it visible instead.
 *
 * It cannot be closed here. /api/log/client-error must accept anonymous reports from guests'
 * browsers or it stops being telemetry, and this repository is public, so every field an attacker
 * needs is known. The real fix is authentication or corroborating signal — several distinct
 * sources, albums or addresses behind one incident — not a different number in this file.
 * tests/error-alert-grouping.test.ts asserts the residual so nobody can believe the old claim.
 *
 * WALL CLOCK, CLAMPED (rule 22). Both elapsed times are differences of two stored readings; a clock
 * correction can make either negative or enormous. Negative or absurd is treated as "the window has
 * passed", which errs toward SENDING — the direction that cannot hide an incident.
 */
export function alertVerdict(input: {
  count: number
  signature: string
  previous: AlertState | null
  nowMs: number
}): AlertVerdict {
  const { count, signature, previous, nowMs } = input
  if (count < THRESHOLD) return { send: false, reason: 'below-threshold' }

  const elapsed = (iso: string | undefined): number | null => {
    if (!iso) return null
    const then = Date.parse(iso)
    if (!Number.isFinite(then)) return null
    const ms = nowMs - then
    // Backwards, or implausibly far forward: the clock moved, not the incident.
    if (ms < 0 || ms > 24 * 60 * 60 * 1000) return null
    return ms
  }

  const sinceHourStart = elapsed(previous?.hourStart)
  const withinHour = sinceHourStart !== null && sinceHourStart < 60 * 60 * 1000
  const sentThisHour = withinHour && typeof previous?.sentThisHour === 'number' && previous.sentThisHour > 0
    ? Math.floor(previous.sentThisHour)
    : 0
  if (sentThisHour >= MAX_ALERTS_PER_HOUR) return { send: false, reason: 'hourly-cap' }

  const sinceSent = elapsed(previous?.sentAt)
  const sameIncident = previous?.signature !== undefined && previous.signature === signature
  if (sameIncident && sinceSent !== null && sinceSent < COOLDOWN_MINUTES * 60_000) {
    return { send: false, reason: 'same-incident' }
  }

  const nowIso = new Date(nowMs).toISOString()
  return {
    send: true,
    nextState: {
      sentAt: nowIso,
      signature,
      hourStart: withinHour ? previous?.hourStart : nowIso,
      sentThisHour: sentThisHour + 1,
    },
  }
}

/** One album as the email renders it: a label, never a bare address. */
export type AlertAlbum = { slug: string; title: string; count: number; owner: string }

/**
 * Turn resolved rows into the email's album block.
 *
 * Moved out of the cron route because every judgement in it was a mutation that survived the whole
 * suite: forcing `lookupFailed` false re-opened the rule-20 defect the commit was written to fix,
 * dropping the null filter emailed deleted albums as links to the marketing home page, and gutting
 * the arithmetic printed "and -3 more albums".
 *
 * THE THREE STATES ARE THE POINT. `album: undefined` means the lookup itself failed and we know
 * nothing; `null` means that album is gone; an object means it resolved. Only the second is a
 * reason to drop a row — reporting an album we could not name still tells the operator where to
 * look, while saying nothing implies no album was involved.
 */
export function albumBlockFor(
  rows: Array<{ album_id: string | null; count: number; album?: { title: string; slug: string; email: string } | null }>,
  unlistedByCap: number,
): { albums: AlertAlbum[]; moreAlbums: number; lookupFailed: boolean } {
  const lookupFailed = rows.length > 0 && rows.every((r) => r.album === undefined)
  const albums = rows
    .filter((r) => r.album !== null)
    .map((r) => ({
      slug: r.album?.slug ?? '',
      title: r.album?.title ?? '(could not read this album)',
      count: r.count,
      owner: r.album?.email ?? '(unknown user)',
    }))
  // COUNTED AFTER RESOLUTION. The cap only knows how many albums it left out; albums deleted
  // between the failure and this tick are dropped above, and counting only the first number said
  // "and 3 more" while 5 were unlisted.
  const moreAlbums = Math.max(0, unlistedByCap + (rows.length - albums.length))
  return { albums, moreAlbums, lookupFailed }
}
