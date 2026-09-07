// Mutation set for src/lib/media-input.ts -- run with: node scripts/mutations/run.mjs media-input
export default {
  file: 'src/lib/media-input.ts',
  test: 'tests/media-input.test.ts',
  mutations: [
  { name: 'radius upper clamp removed (999 reaches the album)',
    from: "  return Math.max(0, Math.min(radiusMax, Math.round(value)))", to: "  return Math.max(0, Math.round(value))" },
  { name: 'radius lower clamp removed (-5 applied)',
    from: "  return Math.max(0, Math.min(radiusMax, Math.round(value)))", to: "  return Math.min(radiusMax, Math.round(value))" },
  { name: 'radius not rounded',
    from: "  return Math.max(0, Math.min(radiusMax, Math.round(value)))", to: "  return Math.max(0, Math.min(radiusMax, value))" },
  { name: 'an empty draft becomes radius 0',
    from: "  if (!trimmed) return null\n", to: "  if (!trimmed) return 0\n" },
  { name: 'a non-number draft becomes NaN-clamped 0',
    from: "  if (!Number.isFinite(parsed)) return null\n", to: "" },
  { name: 'interval min clamp removed (0 ms reaches the save)',
    from: "  return Math.max(MIN_SLIDESHOW_INTERVAL_MS, Math.min(MAX_SLIDESHOW_INTERVAL_MS, Math.round(value)))", to: "  return Math.min(MAX_SLIDESHOW_INTERVAL_MS, Math.round(value))" },
  { name: 'interval max clamp removed',
    from: "  return Math.max(MIN_SLIDESHOW_INTERVAL_MS, Math.min(MAX_SLIDESHOW_INTERVAL_MS, Math.round(value)))", to: "  return Math.max(MIN_SLIDESHOW_INTERVAL_MS, Math.round(value))" },
  ],
}
