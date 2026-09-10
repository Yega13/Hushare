import type { Semaphore } from '@/lib/upload/semaphore'
import { isExpectedRefusal } from '@/lib/upload-policy'
import { VIDEO_SOLO_LANE_BYTES, VIDEO_WIDEN_AFTER_CLEAN } from '@/lib/constants'

// HOW MANY VIDEOS GO UP AT ONCE, decided by what the network has actually done.
//
// Videos have their own, tighter lane: a large sustained TUS stream saturates a weak uplink, and a
// venue uplink is what this product runs on. The lane WIDENS only on a proven clean streak, and
// snaps back to strictly serial -- and stops probing for the rest of the session -- the moment the
// network genuinely drops one. The worst it can do is behave exactly like a fixed capacity of one.
//
// "GENUINELY" IS THE WHOLE RULE, and it was a shipped defect. A guest cancelling an upload, and a
// video the product refused on purpose (over the album's minutes, an unsupported codec), both
// arrive at the same place as a network failure. Counting either one collapsed the lane to serial
// for the rest of the session -- on a phone whose connection was fine -- and stopped it ever
// probing again. The distinction lived inline at the call site, next to the toast logic; it lives
// here now, with the semaphore it acts on (rule 15: the decision without its enforcement is
// untestable, and this one enforces by calling setCapacity).

export type VideoOutcome = 'clean' | 'failed' | 'ignore'

/**
 * What a settled video upload says about the NETWORK. A deliberate cancel says nothing. A refusal
 * the product made on purpose says nothing. Everything else is the connection.
 */
export function videoOutcomeOf(error: unknown): VideoOutcome {
  if (error === null || error === undefined) return 'clean'
  if (error instanceof DOMException && error.name === 'AbortError') return 'ignore'
  if (error instanceof Error && isExpectedRefusal(error.message)) return 'ignore'
  return 'failed'
}

export type VideoLane = {
  /** Record a settled upload. `ignore` outcomes never move the lane. */
  note(outcome: VideoOutcome): void
  /** How much of the lane one file takes: a big video takes all of it. */
  weightFor(sizeBytes: number): number
  /** For tests and diagnostics. */
  readonly ceiling: number
}

export function createVideoLane(
  sem: Semaphore,
  ceiling: number,
  widenAfter: number = VIDEO_WIDEN_AFTER_CLEAN,
): VideoLane {
  let cap = Math.max(1, Math.floor(ceiling))
  let streak = 0
  return {
    note(outcome) {
      if (outcome === 'ignore') return
      if (outcome === 'clean') {
        streak += 1
        if (streak >= widenAfter && sem.capacity < cap) {
          sem.setCapacity(sem.capacity + 1)
          streak = 0
        }
        return
      }
      streak = 0
      if (sem.capacity > 1) {
        sem.setCapacity(1)
        // The network has shown it cannot sustain more than one. Do not probe again this session:
        // the cost of being wrong is every remaining video failing once to re-learn it.
        cap = 1
      }
    },
    // A video large enough to saturate the uplink on its own takes the WHOLE lane, so nothing runs
    // beside it. Anything smaller takes one slot.
    weightFor: (sizeBytes) => (sizeBytes >= VIDEO_SOLO_LANE_BYTES ? sem.capacity : 1),
    get ceiling() { return cap },
  }
}
