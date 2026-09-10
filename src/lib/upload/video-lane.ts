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
// "GENUINELY" IS THE WHOLE RULE. A guest cancelling an upload, and a video the product refused on
// purpose (over the album's minutes, an unsupported codec), both arrive at the same catch block as
// a network failure. Counting either one would collapse the lane to serial for the rest of the
// session -- on a phone whose connection was fine -- and stop it ever probing again.
//
// THIS IS A MOVE, NOT A FIX, and an earlier version of this comment claimed otherwise. The
// distinction was made correctly inline from the day the lane shipped (68178fe, 2026-08-03),
// broadened to the shared refusal list on 2026-08-18, and a review on 2026-09-10 checked the
// history and found no window in which the failure described above could actually happen. What
// was wrong was WHERE it lived: three lines of classification at a call site, beside the toast
// logic, where no test could reach them -- so the rule was believed rather than held. It lives
// here now with the semaphore it acts on (rule 15: a decision without its enforcement is
// untestable, and this one enforces by calling setCapacity). Rule 20 applies to comments as much
// as to the screen: do not write down an incident that did not happen.

export type VideoOutcome = 'clean' | 'failed' | 'ignore'

/**
 * What a THROWN value says about the NETWORK. A deliberate cancel says nothing. A refusal the
 * product made on purpose says nothing. Everything else -- including a thrown null, a string, or a
 * plain object -- is the connection.
 *
 * IT NEVER ANSWERS 'clean'. The only caller is a catch block, where "no error" cannot be true, and
 * a null branch returning 'clean' there is a fail-safe pointing the wrong way (rule 19): a wrong
 * 'clean' WIDENS the lane on a network that has just dropped a file, while a wrong 'failed' only
 * makes uploads serial. There was such a branch until a review found it on 2026-09-10; the old
 * inline code it replaced had always treated a thrown null as a failure. A clean upload is
 * reported by the success path calling note('clean') directly, which is where it is actually known.
 */
export function videoOutcomeOf(error: unknown): VideoOutcome {
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
    // A video large enough to saturate the uplink on its own asks for EVERY SLOT THE LANE HAS
    // WHEN IT STARTS, so nothing else begins beside it. Anything smaller takes one slot.
    //
    // KNOWN GAP, measured 2026-09-10, stated here rather than promised away: this is not a
    // guarantee of solitude for the whole upload. The weight is fixed at acquire time and the lane
    // can widen underneath a long one -- a 400 MB clip starting while capacity is 1 holds one
    // slot, and three clean uploads later the lane grows to 2 and a second video joins it. Closing
    // that would mean refusing to widen while a solo file is in flight, which costs more machinery
    // than the case is worth today. What the weight does buy is the common one: a big video never
    // starts alongside others already running at a wider capacity.
    weightFor: (sizeBytes) => (sizeBytes >= VIDEO_SOLO_LANE_BYTES ? sem.capacity : 1),
    get ceiling() { return cap },
  }
}
