// Mutation set for src/lib/safe-next.ts -- run with: node scripts/mutations/run.mjs safe-next
//
// Each of these is a sign-in link that hands a freshly signed-in visitor to another site. The page they
// land on looks like ours; nothing on our side ever sees it happen.
export default {
  file: 'src/lib/safe-next.ts',
  test: 'tests/safe-next.test.ts tests/route-wiring-auth-callback.test.ts',
  mutations: [
    { name: 'THE LANDING IS NOT CHECKED: the double-slash link redirects to evil.example again',
      from: "  return landing.origin === origin ? path : null", to: "  return path" },
    { name: 'the parsed origin is not compared, so any site is a destination',
      from: "  if (parsed.origin !== origin) return null\n", to: "" },
    { name: 'the landing check compares the wrong thing and passes everything',
      from: "  return landing.origin === origin ? path : null", to: "  return parsed.origin === origin ? path : null" },
    { name: 'the query is dropped, so /abcd1234?s=qr loses how the guest arrived',
      from: "  const path = parsed.pathname + parsed.search", to: "  const path = parsed.pathname" },
    { name: 'an unparseable value throws into the sign-in route instead of meaning no destination',
      from: "  try {\n    parsed = new URL(raw, origin)\n  } catch {\n    return null\n  }", to: "  parsed = new URL(raw, origin)" },
    { name: 'an empty value is parsed as the site root, so every sign-in returns to / even when it should use the default',
      from: "  if (!raw) return null\n", to: "" },
  ],
}
