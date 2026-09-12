// Mutation set for src/lib/upload/presign-fields.ts -- run with:
//   node scripts/mutations/run.mjs presign-fields
//
// The rules an upload door enforces before it will sign for a file. They were written out three
// times across the route handlers and nowhere the client could read them, so the only way to learn
// you had broken one was to upload a declaration and get "Missing or invalid fields" back -- which
// is what a guest was told about their own photograph on 2026-09-12 (error_events 1226).
//
// Every mutation here is a rule loosened or a reason misnamed. The zero-byte one is not
// hypothetical: it is the exact condition that produced that row.
export default {
  file: 'src/lib/upload/presign-fields.ts',
  test: 'tests/presign-fields.test.ts',
  mutations: [
    // ── the size rule, which is the one the incident turned on ─────────────────────────────────
    { name: 'A ZERO-BYTE FILE IS A VALID DECLARATION AGAIN -- the whole incident, reintroduced',
      from: 'Number.isInteger(fileSize) && fileSize > 0', to: 'Number.isInteger(fileSize) && fileSize >= 0' },
    { name: 'a fractional size passes (Number.isInteger dropped)',
      from: 'Number.isFinite(fileSize) && Number.isInteger(fileSize) && fileSize > 0',
      to:   'Number.isFinite(fileSize) && fileSize > 0' },

    // ── the name rule ──────────────────────────────────────────────────────────────────────────
    { name: 'the name length ceiling is ten times too high',
      from: 'export const MAX_FILE_NAME_LEN = 255', to: 'export const MAX_FILE_NAME_LEN = 2550' },
    { name: 'a name of exactly the maximum length is refused (off by one)',
      from: 'name.length > 0 && name.length <= MAX_FILE_NAME_LEN',
      to:   'name.length > 0 && name.length < MAX_FILE_NAME_LEN' },
    { name: 'an empty name passes',
      from: "typeof name === 'string' && name.length > 0 && name.length <= MAX_FILE_NAME_LEN",
      to:   "typeof name === 'string' && name.length <= MAX_FILE_NAME_LEN" },

    // ── the type rule ──────────────────────────────────────────────────────────────────────────
    { name: 'an empty content type passes',
      from: "typeof contentType === 'string' && contentType.length > 0",
      to:   "typeof contentType === 'string' && contentType.length >= 0" },

    // ── and WHICH reason is reported, which decides what the guest is told to do ───────────────
    { name: 'THE EMPTY BLOB IS REPORTED SECOND, so a guest is sent to look at a filename they cannot change',
      from: "  if (!fileSizeValid(candidate.size)) return 'empty'\n  if (!fileNameValid(candidate.name)) return 'name'",
      to:   "  if (!fileNameValid(candidate.name)) return 'name'\n  if (!fileSizeValid(candidate.size)) return 'empty'" },
    { name: 'an unreadable file is reported as a bad name',
      from: "  if (!fileSizeValid(candidate.size)) return 'empty'", to: "  if (!fileSizeValid(candidate.size)) return 'name'" },
    { name: 'nothing is ever unusable (the guard becomes a no-op)',
      from: "  if (!fileSizeValid(candidate.size)) return 'empty'\n", to: '' },
  ],
}
