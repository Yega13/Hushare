import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Tests cover the pure, high-stakes logic: access control, money, and the classifiers that decide
// what a guest sees. Anything needing a DATABASE is still out of scope — pretending to test that
// with mocks would assert that the mocks behave, not that the system does.
//
// THE BROWSER IS NO LONGER OUT OF SCOPE, and the numbers are why. On 2026-08-30: src/lib is 6,616
// lines with 139 tests behind it; src/components is 18,914 lines with none, and src/app/api is
// 9,117 with one. Every defect an adversarial review found in the bib-search work sat in a
// component or a route handler, and not one was in lib — which is not luck, it is the untested
// surface. A component that tells a runner "No photos found" while the search is still in flight
// cannot be caught by testing pure functions, because the pure functions were all correct.
//
// .test.tsx files opt into a DOM with `// @vitest-environment jsdom` at the top. Node stays the
// default so the existing suite keeps its speed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // A pepper that exists only for tests. The production pepper is a Worker secret and must never
    // appear in this repository — and it must never be rotated once albums exist, because every
    // stored hash is derived with it. Using a fixed throwaway here keeps the suite deterministic
    // while proving nothing about, and depending on nothing from, the real one.
    //
    // album-password.ts throws when this is absent, which is correct: a missing pepper must fail
    // loudly rather than silently hashing without it. That behaviour is asserted in the suite.
    env: {
      ALBUM_PASSWORD_PEPPER: 'dGVzdC1wZXBwZXItbm90LXRoZS1yZWFsLW9uZS0zMmJ5dGVzIQ==',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // See tests/stubs/server-only.ts — a build-time marker with no runtime behaviour.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
})
