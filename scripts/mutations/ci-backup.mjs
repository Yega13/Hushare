// Mutation set for .github/workflows/backup.yml -- run with: node scripts/mutations/run.mjs ci-backup
//
// The nightly backup is the only off-machine copy of the database. Until 2026-09-12 nothing tested
// this file at all, and it had carried a comment describing the opposite of what it did for
// seventeen days. Each mutation below is a change that would make the workflow WRONG in a way that
// is silent in a green log; tests/ci-workflows.test.ts must fail on every one.
export default {
  file: '.github/workflows/backup.yml',
  test: 'tests/ci-workflows.test.ts',
  mutations: [
    // The defect that prompted the test: a dump made before anyone checked the secrets exist, so a
    // missing R2 secret costs a full database dump before it is named.
    { name: 'A DUMP RUNS BEFORE THE SECRETS ARE CHECKED -- the seventeen-day defect, restored',
      from: "      # CHECKED BEFORE THE DUMP, not after it.",
      to: "      - name: Dump the database\n        run: node scripts/backup-db.mjs\n\n      # CHECKED BEFORE THE DUMP, not after it." },

    { name: 'the secrets check is gone entirely',
      from: "      - name: Check the secrets exist before doing any work",
      to: "      - name: Skip the secrets check" },

    { name: 'the dump step is gone, so the test is asserting about a file it no longer describes',
      from: "      - name: Dump the database",
      to: "      - name: Take a dump of the database" },

    // A stale recovery file must not stop tonight's backup being taken. Running the check before the
    // upload means one bad schema.sql costs a night with no backup at all.
    { name: 'THE RECOVERY-FILE CHECK MOVES AHEAD OF THE UPLOAD, so stale schema.sql means no backup',
      from: "      - name: Upload to R2 and prune old copies",
      to: "      - name: Verify schema.sql still matches the live database\n        run: node scripts/dump-schema.mjs --check\n\n      - name: Upload to R2 and prune old copies" },

    // A dump holds every owner token and every album password hash. Artifacts on a public repo are
    // downloadable by anyone -- this is the exact shape of the ten-night public-bucket incident.
    { name: 'THE DUMP IS PUBLISHED AS A DOWNLOADABLE ARTIFACT (every owner token, every password hash)',
      from: "      - name: Upload to R2 and prune old copies",
      to: "      - uses: actions/upload-artifact@v4\n\n      - name: Upload to R2 and prune old copies" },
  ],
}
