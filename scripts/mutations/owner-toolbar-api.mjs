// Mutation set for the media-settings writes in src/components/owner-toolbar/api.ts -- run with:
// node scripts/mutations/run.mjs owner-toolbar-api
// The panel test drives these through the real component with a held-request fetch rig.
export default {
  file: 'src/components/owner-toolbar/api.ts',
  test: 'tests/media-settings-panels.test.tsx',
  mutations: [
  { name: 'the per-album wire gate is gone (a reopened panel sends while the closed one has a request out)',
    from: "  return afterInFlight(slug, () => fetch('/api/album/media-settings', {", to: "  return afterInFlight(String(Math.random()), () => fetch('/api/album/media-settings', {" },
  { name: 'the gate is keyed by a constant, not the album (two albums wait for each other)',
    from: "  return afterInFlight(slug, () => fetch('/api/album/media-settings', {", to: "  return afterInFlight('media-settings', () => fetch('/api/album/media-settings', {" },
  { name: 'the request is unbounded (a dead connection holds the wire for the page lifetime)',
    from: "    signal: AbortSignal.timeout(MEDIA_SAVE_TIMEOUT_MS),\n", to: "" },
  { name: 'the desktop pin the route echoes is dropped by the client',
    from: "  if (body.desktop_grid_columns !== undefined) applied.desktop_grid_columns = body.desktop_grid_columns\n", to: "" },
  { name: 'the desktop-columns save bypasses the gate',
    from: "  const res = await postMediaSettings(slug, { desktop_grid_columns: desktopGridColumns })",
    to: "  const res = await fetch('/api/album/media-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, desktop_grid_columns: desktopGridColumns }) })" },
  ],
}
