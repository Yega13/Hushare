// HOW FAST WAS THAT BATCH, REALLY — the one number that tells three different problems apart.
//
// "Uploads feel slow" fits a slow connection, a slow phone and a slow server equally well, and
// those are three completely different fixes. A measured kB/s on the admin dashboard is what
// separates them, so it has to be a measurement rather than an impression.
//
// ONE KNOWN STEP IN THE NUMBERS, stated because a metric that changes shape without explanation
// gets investigated as an incident. performance.now() does not advance while a device is suspended,
// and Date.now did. A guest who starts a batch, pockets the phone for five minutes and comes back
// as it finishes used to report a terrible rate for an upload that was asleep, not slow. The new
// number is the honest one, and the 30-day median will step UPWARD once this ships.
//
// WALL CLOCK CANNOT MEASURE A DURATION (rule 22). This was `Date.now() - batchStartedAt`. Date.now
// moves when a phone takes an NTP or NITZ correction, when somebody sets the time by hand, and when
// a device whose clock was wrong — a flat battery, a long power-off — corrects itself on boot. All
// three happen to phones at events, which is the only place this code runs. A correction mid-batch
// does not fail loudly; it poisons the number:
//
//   the clock jumps FORWARD an hour   -> elapsed reads ~3,600,000 ms, the batch reports a few
//                                        hundred bytes per second, and the dashboard median is
//                                        dragged down by a connection that was fine
//   the clock jumps BACKWARD          -> elapsed reads tiny or negative, the batch reports a
//                                        throughput no network can reach, and the median goes up
//
// Either way the metric says the opposite of the truth on exactly the nights it matters. The fix is
// not a clamp, it is not using a clock that jumps: the caller reads lib/clock's monotonicNow and
// elapsedSince, which cannot go backwards, and hands the duration here. The clamp below stays as
// the belt to those braces, and states which way it errs.

/**
 * A batch shorter than this is not measured at all.
 *
 * Dividing by a very small elapsed time produces a throughput no real upload could reach — one
 * cached thumbnail settling in 200 ms would report tens of megabytes a second and drag the median
 * with it. Reporting nothing is honest; reporting a number that cannot be true is worse than
 * silence, because somebody acts on it (rule 20).
 */
export const MIN_MEASURABLE_MS = 500

/**
 * The floor a real measurement is raised to.
 *
 * A rate under half a kilobyte a second rounds to 0, and 0 is not a third answer -- the analytics
 * route turns an ABSENT kbps into 0 too, and both the fold and the query then drop zeros. So "we
 * did not measure" and "this was the worst upload of the night" would land in the same bucket and
 * neither would reach the median. One 200 KB photo over seven minutes is a real event on venue
 * Wi-Fi, and it is exactly the one worth seeing.
 */
const SLOWEST_REPORTABLE_KBPS = 1

/**
 * Kilobytes per second for a finished batch, or undefined when there is nothing honest to report.
 *
 * `deliveredBytes` IS THE BYTES THAT CROSSED THE NETWORK, not the bytes the batch set out to send.
 * The difference is the whole point on the batches this metric exists to explain: ten photos
 * totalling 30 MB on bad venue Wi-Fi, nine of them failing and one 3 MB photo landing in 60
 * seconds, is 51 kB/s. Measured against what was attempted it reads 512 kB/s -- ten times too fast,
 * reported for the worst upload of the night, with the nine failures leaving separately where
 * nothing can pair them back up. The caller counts bytes as each file finishes.
 *
 * Undefined for: nothing actually saved (a batch that failed has no throughput, only a failure),
 * too little time to divide by, no bytes, and any input that is not a finite number.
 *
 * Errs toward SILENCE. A missing data point leaves the dashboard median where it was; a wrong one
 * moves it, and nothing downstream can tell the two apart afterwards.
 */
export function batchThroughputKbps(
  deliveredBytes: number,
  elapsedMs: number,
  savedCount: number,
): number | undefined {
  if (!Number.isFinite(deliveredBytes) || deliveredBytes <= 0) return undefined
  if (!Number.isFinite(elapsedMs) || elapsedMs <= MIN_MEASURABLE_MS) return undefined
  if (!Number.isFinite(savedCount) || savedCount <= 0) return undefined
  return Math.max(SLOWEST_REPORTABLE_KBPS, Math.round((deliveredBytes / 1024) / (elapsedMs / 1000)))
}

/**
 * How many files of this batch never landed.
 *
 * Never negative, and that is the point rather than tidiness: `attempted - saved` goes negative the
 * moment a retry saves a row the original attempt also counted, and a negative "lost" reported to
 * the dashboard is a count somebody has to explain rather than a number they can act on.
 */
export function lostCount(attempted: number, savedCount: number): number {
  if (!Number.isFinite(attempted) || !Number.isFinite(savedCount)) return 0
  return Math.max(0, attempted - savedCount)
}
