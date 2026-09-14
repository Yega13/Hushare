// Mutation set for the 503 branch in src/app/api/album/resolve/route.ts -- run with:
//   node scripts/mutations/run.mjs resolve-route-unavailable
export default {
  file: 'src/app/api/album/resolve/route.ts',
  test: 'tests/route-wiring-album-resolve.test.ts',
  mutations: [
    { name: 'A FAILED READ GETS NO ANSWER AT ALL from the resolve route',
      from: "    case 'unavailable':\n      // 503, never 404: the read failed and the album may well exist. classifyResolve turns any\n      // failure other than a 404 into the page's retry screen.\n      return NextResponse.json({ error: 'Could not load this album right now' }, { status: 503, headers: NO_STORE })\n",
      to: '' },
    { name: 'a failed read is answered 404, which the page shows as "album not found"',
      from: "{ error: 'Could not load this album right now' }, { status: 503, headers: NO_STORE }",
      to: "{ error: 'Could not load this album right now' }, { status: 404, headers: NO_STORE }" },
  ],
}
