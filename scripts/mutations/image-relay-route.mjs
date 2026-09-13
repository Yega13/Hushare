// Mutation set for src/app/api/upload/image-relay/route.ts -- run with:
//   node scripts/mutations/run.mjs image-relay-route
//
// The route that writes a photo's bytes into R2 when a network blocks R2's own domain. Until
// 2026-09-13 no test executed it, and its buffered branch stored an empty body as a zero-byte object
// behind a 200. R2's listing found 14 photo rows pointing at exactly that.
//
// Every mutation here leaves the upload looking successful or the refusal looking reasonable. The
// failure mode of a storage route is not a crash; it is a row pointing at nothing.
export default {
  file: 'src/app/api/upload/image-relay/route.ts',
  test: 'tests/route-wiring-image-relay.test.ts',
  mutations: [
    { name: 'ZERO BYTES ARE STORED AGAIN and answered 200 -- fourteen photo rows in R2 look like this',
      from: "    if (buffered.byteLength === 0) {", to: "    if (false) {" },
    { name: 'the empty check can never fire',
      from: "    if (buffered.byteLength === 0) {", to: "    if (buffered.byteLength < 0) {" },
    { name: 'the empty body is refused in words the guest cannot act on',
      from: "      return NextResponse.json({ error: READ_FAILURE_MESSAGE }, { status: 400, headers: NO_STORE })",
      to: "      return NextResponse.json({ error: 'Empty body' }, { status: 400, headers: NO_STORE })" },
    { name: 'the empty body is refused as a 5xx, so the client spends its retries resending nothing',
      from: "{ error: READ_FAILURE_MESSAGE }, { status: 400, headers: NO_STORE }",
      to: "{ error: READ_FAILURE_MESSAGE }, { status: 503, headers: NO_STORE }" },
    { name: 'the buffered bytes are swapped for nothing before storage, behind a 200',
      from: "    putPromise = bucket.put(key, buffered, {", to: "    putPromise = bucket.put(key, new ArrayBuffer(0), {" },
    { name: 'a declared size is buffered instead of streamed, holding the whole photo in Worker memory',
      from: "  if (declaredSize !== null) {", to: "  if (false) {" },
    { name: 'an authorization refusal is ignored and the bytes are stored anyway',
      from: "  if (!auth.ok) return auth.response\n", to: "" },
    { name: 'invalid fields reach authorization and storage',
      from: "  if (!UUID_RE.test(albumId) || !fileNameValid(fileName) || !contentTypeValid(contentType)) {",
      to: "  if (false) {" },
  ],
}
