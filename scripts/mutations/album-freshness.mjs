// Mutation set for src/lib/album-freshness.ts -- run with: node scripts/mutations/run.mjs album-freshness
// Covers the seed and the delta merge (the probe/decision functions predate the practice and are
// held by tests/album-freshness.test.ts without a set yet).
export default {
  file: 'src/lib/album-freshness.ts',
  test: 'tests/album-freshness.test.ts',
  mutations: [
  { name: 'an oldest-first album past the window seeds from the 500 oldest rows (the duplicate fetch returns)',
    from: "  if (order !== 'newest' && photos.length < total) return null\n", to: "" },
  { name: 'only newest-first ever seeds (small albums re-fetch for nothing)',
    from: "  if (order !== 'newest' && photos.length < total) return null\n", to: "  if (order !== 'newest') return null\n" },
  { name: 'the boundary is off by one (an album one row past the window seeds from its oldest rows)',
    from: "  if (order !== 'newest' && photos.length < total) return null\n", to: "  if (order !== 'newest' && photos.length + 1 < total) return null\n" },
  { name: 'latest is the first row, not the max',
    from: "    latest: photos.reduce<string | null>((max, p) => (!max || p.created_at > max ? p.created_at : max), null),",
    to: "    latest: photos[0]?.created_at ?? null," },
  { name: 'a missing total still seeds',
    from: "  if (!photos || typeof total !== 'number') return null\n", to: "  if (!photos) return null\n" },
  { name: 'nothing new still returns a fresh array (the grid re-packs on every probe)',
    from: "  if (added.length === 0) return prev\n", to: "" },
  { name: 'rows already present are added again',
    from: "  const added = incoming.filter((p) => !have.has(p.id))", to: "  const added = incoming" },
  { name: 'oldest-first sorts descending',
    from: "    merged.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))",
    to: "    merged.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))" },
  { name: 'a hand-arranged album gets sorted',
    from: "  } else if (order !== 'manual') {", to: "  } else {" },
  { name: 'the default order is not sorted',
    from: "  } else if (order !== 'manual') {", to: "  } else if (order === 'newest') {" },
  { name: 'newest-first ties are broken ascending',
    from: "    merged.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))",
    to: "    merged.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))" },
  ],
}
