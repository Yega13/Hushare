// HOW MUCH INDEXING ONE CRON TICK CAN AFFORD.
//
// A Worker invocation on the paid plan may make 1000 subrequests. Indexing one photo costs three
// (fetch the image, call Rekognition, write the row), so a full 100-photo batch is 300 and an album
// running bib AND faces is 600. Both indexers sized themselves against that number independently,
// and both did the arithmetic for ONE album, because that is how an upload-triggered sweep uses
// them. The cron loops over EVERY album with indexing switched on, and going over the ceiling does
// not slow indexing down — it makes the whole invocation fail.
//
// THIS LIVES IN ITS OWN FILE SO THE TEST CAN RUN THE REAL THING.
//
// It did not, and that cost a blocker. The budget logic was inline in the route and the test
// re-implemented it to check it — including a clamp the route did not have. The test passed, 8/8,
// against a cron that charged 281 photos for a batch the indexer clamps to 100, exhausted the
// budget on the first album, and skipped face indexing on every single tick. The cron is the only
// caller that indexes faces, so Face Finder would have gone into a live event with an empty
// collection. A test that re-implements the code it is testing tests the re-implementation.
export const SUBREQUEST_BUDGET = 1000
// Held back for the handler's own queries and for the headroom every previous measurement assumed.
export const BUDGET_RESERVE = 150
// Per photo: fetch the image, call Rekognition, write the row.
export const SUBREQUESTS_PER_PHOTO = 3
// Per batch, before any photo: re-read the album, check the owner's tier, select the pending rows.
export const SUBREQUESTS_PER_BATCH = 5

export type SubrequestBudget = {
  /**
   * The largest batch still affordable, never more than `batchMax`.
   *
   * Clamping to `batchMax` is not tidiness. The indexers clamp any larger cap to their own BATCH
   * internally, so charging for the unclamped number bills the budget for work that cannot happen
   * — which is the same class of mistake as not charging at all, and it starved face indexing
   * completely.
   */
  affordable: (batchMax: number) => number
  /** Charge the budget BEFORE the call. A batch that comes back short spent less, but guessing low
   *  is what overruns the ceiling and kills the whole invocation. */
  charge: (cap: number) => void
  /** What has been budgeted so far — reported by the cron so a starved tick is visible. */
  spent: () => number
}

export function createSubrequestBudget(): SubrequestBudget {
  let spent = 0
  return {
    affordable(batchMax: number): number {
      const left = SUBREQUEST_BUDGET - BUDGET_RESERVE - spent - SUBREQUESTS_PER_BATCH
      if (left < SUBREQUESTS_PER_PHOTO) return 0
      return Math.min(batchMax, Math.floor(left / SUBREQUESTS_PER_PHOTO))
    },
    charge(cap: number): void {
      spent += cap * SUBREQUESTS_PER_PHOTO + SUBREQUESTS_PER_BATCH
    },
    spent: () => spent,
  }
}
