// Mutation set for src/lib/server/request-error.ts -- run with:
//   node scripts/mutations/run.mjs request-error
//
// What a server error row carries. Each mutation below leaves the panel quiet about a real failure,
// fills it with Next's own redirects, or writes a URL's query string into the error table.
export default {
  file: 'src/lib/server/request-error.ts',
  test: 'tests/request-error.test.ts',
  mutations: [
    { name: 'EVERY REDIRECT AND NOT-FOUND IS FILED AS AN ERROR',
      from: '  if (digest && CONTROL_FLOW_DIGESTS.some((d) => digest.startsWith(d))) return null', to: '  if (false) return null' },
    { name: 'a notFound() thrown in a route handler is filed as an error',
      from: "  'NEXT_HTTP_ERROR_FALLBACK',\n", to: '' },
    { name: 'A QUERY STRING -- AND ANY TOKEN IN IT -- IS WRITTEN TO THE ERROR TABLE',
      from: "  const path = String(request.path ?? '').split('?')[0].split('#')[0]", to: "  const path = String(request.path ?? '')" },
    { name: 'the digest is dropped, so a browser #419 cannot be matched to its server row',
      from: '  if (digest) described.digest = digest.slice(0, 100)\n', to: '' },
    { name: 'the render source is dropped',
      from: '  if (context.renderSource) described.renderSource = context.renderSource\n', to: '' },
    { name: 'the whole stack is kept',
      from: '.split(NEWLINE).slice(1, 6)', to: '.split(NEWLINE).slice(1, 60)' },
    { name: 'every row has the same source, so no route can be told apart',
      from: "    source: `${context.routeType || 'request'}:${context.routePath || path}`,", to: "    source: 'request-error'," },
    { name: 'the error type is dropped from the message',
      from: '    message: err instanceof Error ? `${err.name}: ${err.message}` : String(err),', to: '    message: err instanceof Error ? err.message : String(err),' },
    { name: 'a missing method is written as empty',
      from: "  const described: Record<string, Json> = { path, method: request.method || 'GET' }", to: '  const described: Record<string, Json> = { path, method: request.method }' },
    { name: 'NOTHING IS EVER FILED',
      from: '    if (described) report(described.source, described.message, { context: described.context })', to: '    void described' },
  ],
}
