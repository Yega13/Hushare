// Mutation set for src/lib/album-delete.ts -- run with: node scripts/mutations/run.mjs album-delete
// Each entry is a change that would make the code WRONG; the tests in tests/deletion.test.ts must fail on it.
// Only the pure functions are mutated here; the sweep itself needs a database and is held by source scans.
export default {
  file: 'src/lib/album-delete.ts',
  test: 'tests/deletion.test.ts',
  mutations: [
  { name: 'partitionDeletable accepts every backend (an unknown row reaches collectDeletionTargets)',
    from: "    if (isOneOf(STORAGE_BACKENDS, row.storage_backend)) deletable.push({ ...row, storage_backend: row.storage_backend })\n    else unknown.push({ id: row.id, storage_backend: row.storage_backend })",
    to:   "    deletable.push({ ...row, storage_backend: row.storage_backend as StorageBackendValue })" },
  { name: 'partitionDeletable drops known rows too (nothing is ever deletable)',
    from: "    if (isOneOf(STORAGE_BACKENDS, row.storage_backend)) deletable.push({ ...row, storage_backend: row.storage_backend })\n    else unknown.push",
    to:   "    if (false) deletable.push({ ...row, storage_backend: row.storage_backend as StorageBackendValue })\n    else unknown.push" },
  { name: 'partitionDeletable loses the unknown ids (report would name nothing)',
    from: "    else unknown.push({ id: row.id, storage_backend: row.storage_backend })",
    to:   "    else unknown.push({ id: '', storage_backend: row.storage_backend })" },
  { name: 'a survivor no longer protects its storage_path',
    from: "    if (row.storage_path) r2Keys.add(row.storage_path)\n    if (row.stream_uid) streamUids.add(row.stream_uid)",
    to:   "    if (row.stream_uid) streamUids.add(row.stream_uid)" },
  { name: 'a survivor no longer protects its thumbnail',
    from: "    const thumbKey = r2KeyFromUrl(row.thumb_url)\n    if (thumbKey) r2Keys.add(thumbKey)\n    const posterKey = r2KeyFromUrl(row.poster_url)",
    to:   "    const posterKey = r2KeyFromUrl(row.poster_url)" },
  { name: 'a survivor no longer protects its poster',
    from: "    const posterKey = r2KeyFromUrl(row.poster_url)\n    if (posterKey) r2Keys.add(posterKey)\n  }\n  return { r2Keys, streamUids }\n}\n\nexport function withoutStillReferenced",
    to:   "  }\n  return { r2Keys, streamUids }\n}\n\nexport function withoutStillReferenced" },
  { name: 'a survivor no longer protects its stream uid',
    from: "    if (row.stream_uid) streamUids.add(row.stream_uid)\n    const thumbKey",
    to:   "    const thumbKey" },
  { name: 'withoutStillReferenced goes back to reading the backend (protects less)',
    from: "  const kept = keysReferencedBy(surviving)",
    to:   "  const kept = keysReferencedBy(surviving.filter((r) => r.stream_uid === null))" },
  ],
}
