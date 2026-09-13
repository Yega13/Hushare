// Mutation set for src/components/OptionalPanel.tsx -- run with:
//   node scripts/mutations/run.mjs optional-panel
//
// lib/optional-load decides; this proves the component carries the decision out. Each mutation below
// still renders something reasonable, and each one either blanks a guest's album again, reloads it
// again, loses the report, or strands them with a button that does nothing.
export default {
  file: 'src/components/OptionalPanel.tsx',
  test: 'tests/optional-panel.test.tsx',
  mutations: [
    { name: 'A REAL STALE DEPLOY NO LONGER HEALS ITSELF -- the reload is decided and never done',
      from: "        if (reloading) reloadOnceForStaleDeploy()\n", to: "" },
    { name: 'THE SPENT RELOAD IS NOT CONSULTED, so the device that cannot fetch the chunk reloads again',
      from: "        const reloading = shouldReloadForOptional(part, error, staleReloadStillAvailable())",
      to: "        const reloading = shouldReloadForOptional(part, error, true)" },
    { name: 'the failure is contained and never reported, so the panel goes quiet about a lost upload',
      from: "        reportClientError(optionalLoadFailure(part, error, reloading))\n", to: "" },
    { name: 'a healed stale deploy is filed as a lost panel',
      from: "optionalLoadFailure(part, error, reloading)", to: "optionalLoadFailure(part, error)" },
    { name: 'the fallback is dropped, so the guest reads the untranslated default instead',
      from: "      fallback={", to: "      data-fallback={" },
    { name: "the guest's retry does nothing",
      from: "            onClick={onRetry}", to: "            onClick={() => {}}" },
    { name: 'the fallback line is hard-coded English instead of translated',
      from: "            {t('common.errorGeneric')}", to: "            {'Something went wrong.'}" },
  ],
}
