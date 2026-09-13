// Mutation set for the size bound in src/lib/optional-load.ts, proven against the REAL sink -- run with:
//   node scripts/mutations/run.mjs optional-load-sink
//
// tests/optional-load.test.ts pins the number. This proves the number is small enough: with the bound
// lifted, the worst real crash report is larger than the log route keeps, and the route drops the
// whole context -- stack, component and forensics together.
export default {
  file: 'src/lib/optional-load.ts',
  test: 'tests/optional-panel-report.test.tsx',
  mutations: [
    { name: 'the component stack is unbounded, so the worst crash report loses its whole context at the route',
      from: "export const COMPONENT_STACK_MAX = 200", to: "export const COMPONENT_STACK_MAX = 100000" },
  ],
}
