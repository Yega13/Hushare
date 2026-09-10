import { realTimers, type Timers } from '@/lib/settings-sync'

// WRITING THE ROWS: one request per batch, in order, and an honest answer about each one.
//
// A photo exists in two places: its bytes in R2, and its row in the database. The bytes go up one
// file at a time; the rows are written in batches moments later, and everything that can go wrong
// between those two facts is decided here.
//
//   * DEBOUNCED, not per file. Fifty photos finishing in two seconds are one insert, not fifty.
//   * SERIAL. A slow save never interleaves with the next one, so the rows arrive in the order the
//     files finished and two requests can never race for the same album's capacity.
//   * THE SERVER NAMES WHAT IT REFUSED, and that list is honoured. Ticking a whole batch green on
//     a 200 marked a video "done" that was never written -- the guest sees a finished tile for a
//     video that is not in the album, which is worse than an honest error because nothing prompts
//     them to fix it.
//   * A REFUSED UPLOAD SESSION GETS NO ROWS BACK. Its token is already spent, so re-SAVING is
//     refused forever; only a fresh upload works. Those entries reach the tile's Retry button
//     rather than the "finish the job" queue, which is the opposite of what a refused SAVE needs.
//   * The over-limit warning is shown once per session, not once per batch.
//
// The timer lives here with the rules (rule 15): the debounce is meaningless without the flush,
// and a cancellation that lives at the call site cannot be tested.

export const SAVE_DEBOUNCE_MS = 2500

export const REFUSED_SESSION_MESSAGE = 'its upload session had already been used. Tap Retry to send it again.'

export type SaveOutcome = { warning?: string; rejected?: string[] }

/**
 * Which of a batch the server actually wrote. `rejected` carries the stream uids it refused; a row
 * without one cannot be refused this way, and a missing or empty list means everything landed.
 */
export function partitionRefused<B extends { row: { stream_uid?: string | null } }>(
  batch: B[],
  rejected: string[] | undefined | null,
): { saved: B[]; lost: B[] } {
  const refused = new Set(rejected ?? [])
  const lost = batch.filter((b) => b.row.stream_uid && refused.has(b.row.stream_uid))
  // The SAME array back when nothing was refused, which is every ordinary batch: the caller ticks
  // `saved` green, and a fresh array there would be a second list to keep in step with this one.
  if (lost.length === 0) return { saved: batch, lost: [] }
  const lostSet = new Set(lost)
  return { saved: batch.filter((b) => !lostSet.has(b)), lost }
}

export type RowSaverConfig<R> = {
  /** Send one batch. Rejects on a transport or server failure; resolves with what was refused. */
  save: (rows: R[]) => Promise<SaveOutcome>
  onSaved: (entryIds: string[]) => void
  /** `rows` is present only when the rows can be RE-SAVED; a spent upload session gets none. */
  onFailed: (entryIds: string[], message: string, code?: string, rows?: R[], nudge?: string) => void
  onWarning?: (message: string) => void
  timers?: Timers
  debounceMs?: number
}

export function createRowSaver<R extends { stream_uid?: string | null }>(config: RowSaverConfig<R>) {
  const timers = config.timers ?? realTimers
  const debounceMs = config.debounceMs ?? SAVE_DEBOUNCE_MS
  let queue: { row: R; entryId: string }[] = []
  let timer: number | null = null
  let chain: Promise<void> = Promise.resolve()
  let savedCount = 0
  let warned = false

  const flush = () => {
    if (timer !== null) { timers.clear(timer); timer = null }
    if (queue.length === 0) return
    const batch = queue
    queue = []
    chain = chain.then(async () => {
      try {
        const { warning, rejected } = await config.save(batch.map((b) => b.row))
        const { saved, lost } = partitionRefused(batch, rejected)
        savedCount += saved.length
        config.onSaved(saved.map((b) => b.entryId))
        if (lost.length > 0) config.onFailed(lost.map((b) => b.entryId), REFUSED_SESSION_MESSAGE)
        if (warning && !warned) { warned = true; config.onWarning?.(warning) }
      } catch (e) {
        // The rows travel back so the caller can hold them for a re-save: their bytes are already
        // in R2, and only the insert was turned away. Dropping them here cost people photos they
        // had successfully uploaded, with nothing server-side to reconcile the orphans.
        config.onFailed(
          batch.map((b) => b.entryId),
          e instanceof Error ? e.message : 'Failed to save',
          (e as { code?: string })?.code,
          batch.map((b) => b.row),
          (e as { nudge?: string })?.nudge,
        )
      }
    })
  }

  return {
    add(row: R, entryId: string) {
      queue.push({ row, entryId })
      if (timer === null) timer = timers.set(flush, debounceMs)
    },
    /** Flush the remainder and resolve once every pending save has settled. */
    async finish(): Promise<number> {
      flush()
      await chain
      return savedCount
    },
    /** For tests and diagnostics: is a batch waiting for its debounce? */
    pending: () => queue.length,
  }
}
