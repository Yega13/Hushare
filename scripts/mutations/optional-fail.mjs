// Mutation set for failOptionalPart in src/lib/optional-load.ts -- run with:
//   node scripts/mutations/run.mjs optional-fail
//
// The executor both callers share: OptionalPanel's error boundary, and the share menu's table-card
// download, which catches its own failure. These were three lines inside OptionalPanel until a second
// caller needed them (rule 15). Each mutation below still reports something -- and each one either
// stops a stale deploy healing itself, reloads a device that has already spent its reload, loses the
// report, hides the component that threw, or tells a caller the page is staying when it is not.
export default {
  file: 'src/lib/optional-load.ts',
  test: 'tests/optional-panel.test.tsx',
  mutations: [
    { name: 'A REAL STALE DEPLOY NO LONGER HEALS ITSELF -- the reload is decided and never done',
      from: "  if (reloading) reloadOnceForStaleDeploy()\n", to: "" },
    { name: 'THE SPENT RELOAD IS NOT CONSULTED, so the device that cannot fetch the chunk reloads again',
      from: "  const reloading = shouldReloadForOptional(part, error, staleReloadStillAvailable())",
      to: "  const reloading = shouldReloadForOptional(part, error, true)" },
    { name: 'the failure is contained and never reported',
      from: "  reportClientError(optionalLoadFailure(part, error, reloading, componentStack))\n", to: "" },
    { name: 'a healed stale deploy is filed as a lost panel',
      from: "optionalLoadFailure(part, error, reloading, componentStack)", to: "optionalLoadFailure(part, error, false, componentStack)" },
    { name: 'the component that threw never reaches the report',
      from: "reloading, componentStack))", to: "reloading))" },
    { name: 'the caller is always told the page is staying, so the owner gets a toast that vanishes in the reload',
      from: "  return reloading\n}", to: "  return false\n}" },
  ],
}
