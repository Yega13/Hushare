// Mutation set for src/lib/report-server-error.ts -- run with:
//   node scripts/mutations/run.mjs report-server-error
//
// The one path every server failure takes to the admin panel. Each mutation below still "reports" --
// and each one either files failures somewhere nobody looks, loses them when the response returns,
// or leaves the panel clean while the product is broken.
export default {
  file: 'src/lib/report-server-error.ts',
  test: 'tests/report-server-error.test.ts',
  mutations: [
    { name: 'server failures are filed as warnings, so the error alarm never counts them',
      from: "        p_level: 'error',", to: "        p_level: 'warn'," },
    { name: 'the server: prefix is dropped, so a server failure cannot be told from a browser one',
      from: '        p_source: `server:${source}`.slice(0, 60),', to: '        p_source: source.slice(0, 60),' },
    { name: 'the message is unbounded',
      from: '        p_message: String(message).slice(0, 500),', to: '        p_message: String(message),' },
    { name: 'the album is never attached, so /admin cannot say whose album broke',
      from: '        p_album_id: opts.albumId ?? null,', to: '        p_album_id: null,' },
    { name: 'the account is dropped, so a failed checkout names nobody',
      from: '  const context = opts.account ? { ...(opts.context ?? {}), account: opts.account } : opts.context', to: '  const context = opts.context' },
    { name: 'THE REPORT IS NOT KEPT ALIVE -- on Workers it dies when the response returns',
      from: '        getCloudflareContext().ctx.waitUntil(Promise.resolve(p))', to: '        void p' },
    { name: 'a coalescing failure loses the report instead of inserting it directly',
      from: '        if (!error) return\n', to: '        return\n' },
    // NOT MUTATED -- `e instanceof Error ? \`${e.name}: ${e.message}\` : String(e)` against a bare
    // String(e): Error.prototype.toString produces the same "Name: message" text, so the two are
    // equivalent for every Error that does not override toString, and no test should pretend otherwise.
  ],
}
