import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Tests cover the pure, high-stakes logic: access control, money, and the classifiers that decide
// what a guest sees. Anything needing a database or a browser is deliberately out of scope — those
// belong in an integration suite, and pretending to test them with mocks would assert that the
// mocks behave, not that the system does.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
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
