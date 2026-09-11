// Mutation set for the BATCH MEASUREMENT WIRING in src/components/UploadZone.tsx -- run with:
//   node scripts/mutations/run.mjs upload-zone-throughput
//
// scripts/mutations/throughput.mjs proves the module. This proves the lines that decide whether it
// is used, and with what -- including the two that matter most, which are which CLOCK the duration
// comes from and which BYTES the rate is measured against. Both are invisible at the call site: a
// wall-clock reading and a monotonic one produce identical numbers on a machine whose clock never
// moves, and attempted bytes and delivered bytes are identical on a batch where nothing fails.
export default {
  file: 'src/components/UploadZone.tsx',
  test: 'tests/upload-zone-wiring.test.ts',
  mutations: [
  // ── the clock ────────────────────────────────────────────────────────────────────────────────
  { name: 'THE BATCH CLOCK GOES BACK TO Date.now, and a correction mid-batch poisons the number',
    from: "    const batchStartedAt = monotonicNow()", to: "    const batchStartedAt = Date.now()" },
  { name: 'a wall-clock reading appears somewhere ELSE in the file (the negative pin, on its own)',
    // The positive pin on the line above kills the mutation above it, so nothing had yet shown that
    // the whole-file "no Date.now anywhere" assertion can fire at all. This is that proof.
    from: "    let deliveredBytes = 0", to: "    let deliveredBytes = Date.now() * 0" },
  { name: 'and the other spelling of the same habit',
    from: "    let deliveredBytes = 0", to: "    let deliveredBytes = new Date().getTime() * 0" },
  { name: 'the duration is computed by hand from the monotonic clock, losing the clamp',
    from: "batchThroughputKbps(deliveredBytes, elapsedSince(batchStartedAt), savedCount)",
    to: "batchThroughputKbps(deliveredBytes, monotonicNow() - batchStartedAt, savedCount)" },
  { name: 'the rate is measured against a literal duration rather than the real one',
    from: "batchThroughputKbps(deliveredBytes, elapsedSince(batchStartedAt), savedCount)",
    to: "batchThroughputKbps(deliveredBytes, 10_000, savedCount)" },

  // ── the bytes ────────────────────────────────────────────────────────────────────────────────
  { name: 'THE RATE IS MEASURED AGAINST BYTES ATTEMPTED, so a mostly-failed batch reads ten times too fast',
    from: "    let deliveredBytes = 0   // bytes that actually crossed the network, counted as each file lands",
    to: "    let deliveredBytes = toUpload.reduce((n, e) => n + (e.file?.size ?? 0), 0)" },
  { name: 'bytes are never counted at all, so no batch is ever measured',
    from: "          deliveredBytes += entry.file.size\n", to: "" },
  { name: 'the rate is measured against the files ATTEMPTED rather than the ones that landed',
    from: "batchThroughputKbps(deliveredBytes, elapsedSince(batchStartedAt), savedCount)",
    to: "batchThroughputKbps(deliveredBytes, elapsedSince(batchStartedAt), toUpload.length)" },

  // ── what was lost ────────────────────────────────────────────────────────────────────────────
  { name: 'lost is computed inline again, so a retry can report a negative count',
    from: "    const lost = lostCount(toUpload.length, savedCount)",
    to: "    const lost = toUpload.length - savedCount" },
  { name: 'lost compares the wrong two numbers',
    from: "    const lost = lostCount(toUpload.length, savedCount)",
    to: "    const lost = lostCount(savedCount, toUpload.length)" },
  ],
}
