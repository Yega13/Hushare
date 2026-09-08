// ONE WRITE AT A TIME PER KEY, across everything that holds a copy of the key.
//
// The media panel keeps one request in flight per panel INSTANCE (lib/media-settings-diff, "ONE
// REQUEST AT A TIME"). The panel is mounted only while Settings is open, and a reviewer closed and
// reopened it inside one round trip: the closed instance's request was still out, the new
// instance knew nothing of it, and its request overtook the first -- the database applied the
// owner's second choice and then the first, and the switch flipped itself back. The invariant
// belongs to the resource, the album row, not to whoever holds a copy of it. So a request for an
// album waits here for every earlier request for that album to settle, resolved or rejected.
//
// Errs toward NOT writing: a request that never settles holds the album's wire for the page's
// lifetime. That is the same stall a single instance's `inFlight` would have, and the opposite
// failure -- two writes landing in either order -- is the one nothing on the client can see.

const tails = new Map<string, Promise<void>>()

/**
 * Runs `run` after every earlier run for `key` has settled, in call order, and resolves or rejects
 * with run's own outcome. An idle key runs synchronously -- the caller's request goes out in the
 * same tick it was planned, exactly as it did before the gate existed.
 */
export function afterInFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const prev = tails.get(key)
  const result = prev ? prev.then(run) : new Promise<T>((resolve) => resolve(run()))
  // A failed run must not hold the key: its caller gets the rejection, the queue moves on.
  const tail = result.then(() => undefined, () => undefined)
  tails.set(key, tail)
  void tail.then(() => {
    // Forget the key only if nothing newer queued behind this run.
    if (tails.get(key) === tail) tails.delete(key)
  })
  return result
}
