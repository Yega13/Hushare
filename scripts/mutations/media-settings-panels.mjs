// Mutation set for the media panel COMPONENT -- run with: node scripts/mutations/run.mjs media-settings-panels
// The lib machine has its own set; these are the wiring mistakes the component test exists to catch.
export default {
  file: 'src/components/owner-toolbar/MediaSettingsPanels.tsx',
  test: 'tests/media-settings-panels.test.tsx',
  mutations: [
  { name: 'the optimistic echo becomes the baseline (the original bug: the album prop is "confirmed")',
    from: "  const adopted = adoptIncomingMedia(media, incoming)\n",
    to: "  const adopted = { confirmed: incoming, draft: media.draft }\n" },
  { name: 'an immediate save no longer cancels the pending debounce (two requests, the second empty or stale)',
    from: "    if (debouncedSaveRef.current !== null) {\n      window.clearTimeout(debouncedSaveRef.current)\n      debouncedSaveRef.current = null\n    }\n    if (when === 'now')",
    to: "    if (when === 'now')" },
  { name: 'a failed save does not tell the album (the grid keeps the refused value)',
    from: "      if (Object.keys(reverted.patch).length > 0) onAlbumUpdated(reverted.patch)\n", to: "" },
  { name: 'closing Settings drops the pending save (the old resync behaviour)',
    from: "      debouncedSaveRef.current = null\n      void saveMediaSettings()\n    }\n  // eslint",
    to: "      debouncedSaveRef.current = null\n    }\n  // eslint" },
  { name: 'the debounced save reads the render closure, not the ref (stale draft)',
    from: "    const plan = planMediaSave(mediaRef.current)\n", to: "    const plan = planMediaSave(media)\n" },
  { name: 'the draft does not follow the server clamp (the slider shows 40 while the server has 32)',
    from: "      const next = confirmMediaSaved(mediaRef.current, sent, result.applied)",
    to: "      const next = confirmMediaSaved(mediaRef.current, {}, result.applied)" },
  { name: 'a slider drag stops telling the grid to draw the global radius',
    from: "    editMedia({ media_radius: clampMediaRadius(value, radiusMax) }, 'debounce', { forceGlobalRadius: true })",
    to: "    editMedia({ media_radius: clampMediaRadius(value, radiusMax) }, 'debounce')" },
  ],
}
