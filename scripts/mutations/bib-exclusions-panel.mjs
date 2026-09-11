// Mutations for the owner's signage panel — the one screen that can hide a runner from their own
// search.
//
// Excluding a number stops it answering everywhere, immediately, on photographs indexed long ago.
// That is the feature. Aimed at a real bib it is also the only mistake in this product that
// produces no complaint: the runner looks, finds nothing, and concludes they were not photographed.
//
// So the properties mutated below are not layout. They are the ones that make an exclusion
// reversible — the row stays on screen, it keeps the count and the photograph the decision was made
// from, and it answers to the number however the two sides spell it.
export default {
  file: 'src/components/owner-toolbar/BibExclusionsSection.tsx',
  test: 'tests/bib-exclusions-panel.test.tsx',
  mutations: [
    {
      name: 'the off state is decided by TEXT, so a row springs back ON when the server canonicalises it',
      from: '          const off = isExcludedNumber(number, excluded)',
      to: '          const off = excluded.includes(number)',
    },
    {
      name: 'un-excluding compares by text, so a second tap posts the number instead of removing it',
      from: '      ? view.excluded.filter((n) => numericKey(n) !== key)',
      to: '      ? view.excluded.filter((n) => n !== number)',
    },
    {
      name: 'a delta is posted instead of the whole list, dropping every other exclusion',
      from: '      : [...view.excluded, number]',
      to: '      : [number]',
    },
    {
      name: 'the count is hidden on every row, taking away the argument the decision rests on',
      from: '                {row.photos > 0 && (',
      to: '                {false && (',
    },
    {
      name: 'a refused save is left on screen looking like it worked',
      from: '        setView(before)\n        showAppToast(result.error, \u0027error\u0027)',
      to: '        showAppToast(result.error, \u0027error\u0027)',
    },
    {
      name: 'the reveal is deleted, so every row past the sixth -- exclusions included -- is unreachable',
      from: '      {!expanded && rows.length > COLLAPSED && (',
      to: '      {false && (',
    },
    {
      name: 'the bar is scaled to the loudest row, so a runner on 4 photographs argues like signage',
      from: '  const scale = albumPhotoCount && albumPhotoCount > 0',
      to: '  const scale = false && albumPhotoCount > 0',
    },
    {
      name: 'a failed load renders the panel, claiming the album has no signage (rule 20)',
      from: '  if (failed || !view) return null',
      to: '  if (!view) return null',
    },
    {
      name: 'the server answer is ignored, so the panel keeps the un-canonicalised optimistic list',
      from: '      setView({ ...before, excluded: result.excluded })',
      to: '      setView({ ...before, excluded: next })',
    },
  ],
}
