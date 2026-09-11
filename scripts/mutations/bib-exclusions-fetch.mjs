// Mutations for the one boundary where an untrusted response becomes a typed object.
//
// The panel reads rows.length during render, and nothing in this app mounts ErrorBoundary -- so a
// throw there reaches app/error.tsx and replaces the owner's whole ALBUM PAGE with an error screen,
// over a dropdown in Settings. A captive portal, a truncated body, or a browser still holding the
// bundle from before this field was renamed all produce a 200 with the wrong shape.
//
// The other direction matters just as much: an EMPTY album is a real answer, and turning it into a
// failure would collapse the distinction this whole feature exists to keep (rule 20).
export default {
  file: 'src/components/owner-toolbar/api.ts',
  test: 'tests/bib-exclusions-fetch.test.ts',
  mutations: [
    {
      name: 'the body is trusted unchecked, so a 200 with the wrong shape crashes the album page',
      from: '    if (!body || !Array.isArray(body.rows) || !Array.isArray(body.excluded)) return null',
      to: '    if (!body) return null',
    },
    {
      name: 'rows is accepted when it is an object rather than an array',
      from: '!Array.isArray(body.rows)',
      to: '!body.rows',
    },
    {
      name: 'a body with no excluded list is accepted, so the off state is read off undefined',
      from: '!Array.isArray(body.excluded)',
      to: 'false',
    },
    {
      name: 'an EMPTY album is reported as a failure, collapsing "none" into "could not ask"',
      from: '    if (!body || !Array.isArray(body.rows) || !Array.isArray(body.excluded)) return null',
      to: '    if (!body || !body.rows?.length || !Array.isArray(body.excluded)) return null',
    },
    {
      name: 'a non-200 is parsed anyway, so an error page body becomes the panel',
      from: '    if (!res.ok) return null',
      to: '    if (false) return null',
    },
  ],
}
