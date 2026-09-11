// Mutation set for src/lib/upload/throughput.ts -- run with:
//   node scripts/mutations/run.mjs throughput
//
// The measured kB/s on the admin dashboard, which is the only thing that separates a slow
// connection from a slow phone from a slow server. Every mutation here makes that number say the
// opposite of the truth, quietly, on exactly the nights it matters -- and nothing downstream can
// tell a wrong data point from a right one after the fact.
export default {
  file: 'src/lib/upload/throughput.ts',
  test: 'tests/throughput.test.ts',
  mutations: [
  { name: 'a batch that saved NOTHING reports the bytes it pushed before dying as a success rate',
    from: "  if (!Number.isFinite(savedCount) || savedCount <= 0) return undefined\n", to: "" },
  { name: 'a batch too short to divide by is measured anyway (one cached thumbnail, tens of MB/s)',
    from: "  if (!Number.isFinite(elapsedMs) || elapsedMs <= MIN_MEASURABLE_MS) return undefined\n", to: "" },
  { name: 'the measurable floor is dropped to nothing',
    from: "export const MIN_MEASURABLE_MS = 500", to: "export const MIN_MEASURABLE_MS = 0" },
  { name: 'the floor is inclusive, so a batch exactly at it is reported',
    from: "  if (!Number.isFinite(elapsedMs) || elapsedMs <= MIN_MEASURABLE_MS) return undefined",
    to: "  if (!Number.isFinite(elapsedMs) || elapsedMs < MIN_MEASURABLE_MS) return undefined" },
  { name: 'a NEGATIVE duration is divided by, which is what a clock jump used to hand it',
    from: "  if (!Number.isFinite(elapsedMs) || elapsedMs <= MIN_MEASURABLE_MS) return undefined",
    to: "  if (!Number.isFinite(elapsedMs) || Math.abs(elapsedMs) <= MIN_MEASURABLE_MS) return undefined" },
  { name: 'a batch with no bytes reports zero rather than nothing',
    from: "  if (!Number.isFinite(deliveredBytes) || deliveredBytes <= 0) return undefined\n", to: "" },
  { name: 'NaN and Infinity are believed',
    from: "  if (!Number.isFinite(deliveredBytes) || deliveredBytes <= 0) return undefined",
    to: "  if (deliveredBytes <= 0) return undefined" },
  { name: 'the rate is per millisecond, so every number is a thousand times too small',
    from: "  return Math.max(SLOWEST_REPORTABLE_KBPS, Math.round((deliveredBytes / 1024) / (elapsedMs / 1000)))",
    to: "  return Math.max(SLOWEST_REPORTABLE_KBPS, Math.round((deliveredBytes / 1024) / elapsedMs))" },
  { name: 'the rate is in bytes rather than kilobytes',
    from: "  return Math.max(SLOWEST_REPORTABLE_KBPS, Math.round((deliveredBytes / 1024) / (elapsedMs / 1000)))",
    to: "  return Math.max(SLOWEST_REPORTABLE_KBPS, Math.round(deliveredBytes / (elapsedMs / 1000)))" },
  { name: 'the division inverts, so a fast batch reports as a slow one',
    from: "  return Math.max(SLOWEST_REPORTABLE_KBPS, Math.round((deliveredBytes / 1024) / (elapsedMs / 1000)))",
    to: "  return Math.max(SLOWEST_REPORTABLE_KBPS, Math.round((elapsedMs / 1000) / (deliveredBytes / 1024)))" },
  { name: 'the slow floor is gone, so a real measurement reads as no measurement downstream',
    from: "  return Math.max(SLOWEST_REPORTABLE_KBPS, Math.round((deliveredBytes / 1024) / (elapsedMs / 1000)))",
    to: "  return Math.round((deliveredBytes / 1024) / (elapsedMs / 1000))" },
  { name: 'LOST GOES NEGATIVE, so a retry that saved a counted row reports a count nobody can explain',
    from: "  return Math.max(0, attempted - savedCount)", to: "  return attempted - savedCount" },
  { name: 'lost is the attempted count, so every batch reports everything as lost',
    from: "  return Math.max(0, attempted - savedCount)", to: "  return attempted" },
  { name: 'an unreadable count reports everything lost instead of nothing',
    from: "  if (!Number.isFinite(attempted) || !Number.isFinite(savedCount)) return 0\n", to: "" },
  ],
}
