// Mutation set for .github/workflows/deploy.yml -- run with: node scripts/mutations/run.mjs ci-deploy
//
// deploy.yml treats two drift checks DIFFERENTLY on purpose, and the difference is load-bearing in
// both directions: src/types/database.ts is read at runtime and its drift must stop the deploy,
// while schema.sql is a recovery artifact whose staleness must never block shipping a fix during an
// incident. Both halves are the kind of thing a tidy-up "corrects" into the other.
export default {
  file: '.github/workflows/deploy.yml',
  test: 'tests/ci-workflows.test.ts',
  mutations: [
    { name: 'DATABASE.TS DRIFT NO LONGER STOPS THE DEPLOY -- the build ships against types it does not match',
      from: "src/types/database.ts has drifted from the live database. Run npm run db:types and commit it — every type guarantee in this build is void until you do.'; exit 1 ;;",
      to: "src/types/database.ts has drifted from the live database. Run npm run db:types and commit it — every type guarantee in this build is void until you do.' ;;" },

    { name: 'SCHEMA.SQL DRIFT NOW BLOCKS THE DEPLOY, so a stale recovery file stops an incident fix shipping',
      from: "node scripts/dump-schema.mjs --check || echo '::error::schema.sql has drifted",
      to: "node scripts/dump-schema.mjs --check || exit 1 || echo '::error::schema.sql has drifted" },

    { name: 'the deploy stops checking schema.sql at all',
      from: "            node scripts/dump-schema.mjs --check || echo",
      to: "            true || echo" },
  ],
}
