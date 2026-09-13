// Mutation set for what failOptionalPart in src/lib/optional-load.ts hands the REAL report sink -- run with:
//   node scripts/mutations/run.mjs optional-panel-report
//
// tests/optional-panel.test.tsx mocks report-error; these mutations only show up when the real one
// runs, because what they break is what report-error DOES with the report: recognise a DOM the
// translator rewrote, file a translated page at warn, and never reload a page whose album is on screen.
export default {
  file: 'src/lib/optional-load.ts',
  test: 'tests/optional-panel-report.test.tsx',
  mutations: [
    { name: 'THE REPORT IS MARKED FATAL -- report-error reloads a translated page with the album still on it',
      from: "  reportClientError(optionalLoadFailure(part, error, reloading, componentStack))",
      to: "  reportClientError({ ...optionalLoadFailure(part, error, reloading, componentStack), fatal: true })" },
    { name: "a crash is sent under the load sentence, so report-error's DOM rule never sees the translator",
      from: "  reportClientError(optionalLoadFailure(part, error, reloading, componentStack))",
      to: "  reportClientError({ ...optionalLoadFailure(part, error, reloading, componentStack), message: `Optional part could not load: ${part}` })" },
  ],
}
