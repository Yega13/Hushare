// Mutation set for src/lib/server/respond.ts -- run with: node scripts/mutations/run.mjs respond
// Each entry is a change that would make the code WRONG; the tests in tests/respond.test.ts must fail on it.
export default {
  file: 'src/lib/server/respond.ts',
  test: 'tests/respond.test.ts',
  mutations: [
  {
    name: 'drop no-store from the serializer',
    from: "headers: { ...NO_STORE, ...extra }",
    to: "headers: { ...extra }",
  },
  {
    name: 'serverError stops reporting',
    from: "  reportServerError(source, message, opts)\n  return json(",
    to: "  return json(",
  },
  {
    name: 'serverError leaks the internal detail to the caller',
    from: "    { error: opts.publicMessage ?? 'Something went wrong on our side. Please try again.' },",
    to: "    { error: message },",
  },
  {
    name: 'askCallerToRetry stops reporting',
    from: "  reportServerError(source, `retry requested: ${reason}`, opts)",
    to: "",
  },
  {
    name: 'Retry-After floors instead of clamping (0.4s becomes 0 = retry now)',
    from: "retryAfter === undefined ? undefined : { 'Retry-After': String(Math.max(1, Math.ceil(retryAfter))) },",
    to: "retryAfter === undefined ? undefined : { 'Retry-After': String(Math.floor(retryAfter)) },",
  },
  {
    name: 'refusals lose their machine-readable reason token',
    from: "    { error: r.message, reason: r.kind },",
    to: "    { error: r.message },",
  },
  // --- refuseAccess: the 31 migrated owner-access sites ---
  {
    name: 'refuseAccess drops Retry-After entirely',
    from: "    fail.retryAfterSeconds === undefined\n      ? undefined\n      : { 'Retry-After': String(Math.max(1, Math.ceil(fail.retryAfterSeconds))) },",
    to: "    undefined,",
  },
  {
    name: 'refuseAccess invents a Retry-After on every failure (a 403 that says retry)',
    from: "    fail.retryAfterSeconds === undefined\n      ? undefined\n      : { 'Retry-After': String(Math.max(1, Math.ceil(fail.retryAfterSeconds))) },",
    to: "    { 'Retry-After': String(Math.max(1, Math.ceil(fail.retryAfterSeconds ?? 60))) },",
  },
  {
    name: 'refuseAccess drops the reason the library computed',
    from: "    { error: fail.error, reason: fail.reason },",
    to: "    { error: fail.error },",
  },
  ],
}
