// Mutation set for src/lib/upload/row-saver.ts -- run with: node scripts/mutations/run.mjs row-saver
// Every mutation here is a way a guest's photo ends up in R2 with no row, or a tile ticked green
// for a photo that is not in the album.
export default {
  file: 'src/lib/upload/row-saver.ts',
  test: 'tests/row-saver.test.ts',
  mutations: [
  { name: 'one save per FILE instead of per batch (fifty requests for fifty photos)',
    from: "      if (timer === null) timer = timers.set(flush, debounceMs)", to: "      timer = timers.set(flush, debounceMs)" },
  { name: 'the debounce timer is never cleared, so finish is followed by an empty second flush',
    from: "    if (timer !== null) { timers.clear(timer); timer = null }\n", to: "" },
  { name: 'saves stop being serial (two requests race for the same album capacity)',
    from: "    chain = chain.then(async () => {", to: "    chain = Promise.resolve().then(async () => {" },
  { name: 'the queue is not taken, so the next batch re-sends the same rows',
    from: "    const batch = queue\n    queue = []", to: "    const batch = queue" },
  { name: 'the whole batch is ticked green, including what the server refused',
    from: "        const { saved, lost } = partitionRefused(batch, rejected)", to: "        const saved = batch, lost = []" },
  { name: 'a refused video is not reported at all (a silent hole in the album)',
    from: "        if (lost.length > 0) config.onFailed(lost.map((b) => b.entryId), REFUSED_SESSION_MESSAGE)\n", to: "" },
  { name: 'a refused upload session is handed rows to re-save (refused forever, never re-uploaded)',
    from: "        if (lost.length > 0) config.onFailed(lost.map((b) => b.entryId), REFUSED_SESSION_MESSAGE)",
    to: "        if (lost.length > 0) config.onFailed(lost.map((b) => b.entryId), REFUSED_SESSION_MESSAGE, undefined, lost.map((b) => b.row))" },
  { name: 'a failed save drops the rows, so the bytes are orphaned and the photo is gone',
    from: "          batch.map((b) => b.row),\n", to: "          undefined,\n" },
  { name: 'a failed save loses the code, so a full album reads as a generic failure',
    from: "          (e as { code?: string })?.code,\n", to: "          undefined,\n" },
  { name: 'the warning nags once per batch',
    from: "        if (warning && !warned) { warned = true; config.onWarning?.(warning) }", to: "        if (warning) { config.onWarning?.(warning) }" },
  { name: 'the saved count is what was queued, not what the server took',
    from: "        savedCount += saved.length", to: "        savedCount += batch.length" },
  { name: 'finish does not wait for the saves it started',
    from: "      flush()\n      await chain\n      return savedCount", to: "      flush()\n      return savedCount" },
  { name: 'an empty queue still issues a save',
    from: "    if (queue.length === 0) return\n", to: "" },
  { name: 'a uid that matches nothing in the batch still takes a photo out of the saved list',
    from: "  if (lost.length === 0) return { saved: batch, lost: [] }\n", to: "" },
  // Not mutated: an early return for an empty `rejected` list. It survived, because the
  // `lost.length === 0` guard below already answers that case -- the line was dead and is gone
  // (MISTAKES 68: a survivor is not always a missing test, sometimes it is dead code).
  ],
}
