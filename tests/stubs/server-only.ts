// `server-only` is a build-time guard: importing it from a client bundle makes the Next build fail.
// It has no runtime behaviour, and it does not resolve outside a Next build, so the test runner
// aliases it here. This stub must stay empty — its whole job is to exist.
export {}
