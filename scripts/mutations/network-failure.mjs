// Mutation set for src/lib/network-failure.ts -- run with: node scripts/mutations/run.mjs network-failure
export default {
  file: 'src/lib/network-failure.ts',
  test: 'tests/network-failure.test.ts',
  mutations: [
  { name: 'a TypeError is not the network', from: "  if (e instanceof TypeError) return true\n", to: "" },
  { name: 'every Error is the network (a server refusal gets the network line)',
    from: "  if (e instanceof TypeError) return true\n", to: "  if (e instanceof Error) return true\n" },
  { name: 'a timeout is not the network',
    from: "(e as { name?: unknown }).name === 'TimeoutError'", to: "false" },
  { name: 'any abort is the network',
    from: "(e as { name?: unknown }).name === 'TimeoutError'", to: "true" },
  ],
}
