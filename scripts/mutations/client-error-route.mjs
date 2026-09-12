// Mutation set for src/app/api/log/client-error/route.ts -- run with:
//   node scripts/mutations/run.mjs client-error-route
//
// The sink every browser report lands in. What matters here for secrets: a message can quote a URL
// too, so it is stripped as well as the context, and the context only ever reaches the table
// through the clamp that strips it (lib/error-context).
export default {
  file: 'src/app/api/log/client-error/route.ts',
  test: 'tests/error-context.test.ts',
  mutations: [
  { name: 'THE MESSAGE IS STORED UNSTRIPPED, so a URL quoted in it keeps its owner token',
    from: "stripUrlSecrets(body.message.trim()).slice(0, 500)", to: "body.message.trim().slice(0, 500)" },
  { name: 'the context skips the clamp that strips it',
    from: "  const context = boundedContext(body.context)", to: "  const context = body.context as Record<string, string>" },
  ],
}
