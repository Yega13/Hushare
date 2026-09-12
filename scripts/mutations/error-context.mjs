// Mutation set for src/lib/error-context.ts -- run with: node scripts/mutations/run.mjs error-context
//
// WHAT A STORED ERROR REPORT MAY CARRY. The part that matters most arrived on 2026-09-11: nothing
// after a ? or # in a URL is stored, because an owner's key rides in the fragment and one was
// stored. Every mutation below either lets a secret through or throws away the part worth reading.
//
// NOT MUTATED -- which characters end a match (quotes, backslashes, brackets). Their text is all
// escapes, and a mutation spelled in escapes is the rule-24 hazard this repo keeps paying for; the
// JSON-safety test holds that behaviour instead.
export default {
  file: 'src/lib/error-context.ts',
  test: 'tests/error-context.test.ts',
  mutations: [
  { name: 'AN OWNER TOKEN IS STORED AGAIN: URL fragments and queries are kept',
    from: "  return text.replace(URL_QUERY_OR_FRAGMENT, '$1').replace(SECRET_PAIR, '$1=[redacted]')",
    to: "  return text.replace(SECRET_PAIR, '$1=[redacted]')" },
  { name: 'a secret key with no URL around it is kept',
    from: "  return text.replace(URL_QUERY_OR_FRAGMENT, '$1').replace(SECRET_PAIR, '$1=[redacted]')",
    to: "  return text.replace(URL_QUERY_OR_FRAGMENT, '$1')" },
  { name: 'the whole URL is deleted with its fragment, taking the part worth reading',
    from: ".replace(URL_QUERY_OR_FRAGMENT, '$1')", to: ".replace(URL_QUERY_OR_FRAGMENT, '')" },
  { name: 'only a fragment is stripped, so a presigned signature is stored',
    from: ")[?#][", to: ")[#][" },
  { name: 'only the first URL in a string is stripped',
    from: "/gi\nconst SECRET_PAIR", to: "/i\nconst SECRET_PAIR" },
  { name: 'the owner key is not redacted on its own',
    from: "(owner|access_token", to: "(access_token" },
  { name: 'a string value is stored unstripped',
    from: "      const clean = stripUrlSecrets(v)", to: "      const clean = v" },
  { name: 'a serialized object is stored unstripped',
    from: "      if (s) out[k] = stripUrlSecrets(s).slice(0, MAX_VALUE_CHARS)", to: "      if (s) out[k] = s.slice(0, MAX_VALUE_CHARS)" },
  { name: 'clamped before stripping, so what follows a URL is cut off',
    from: "      out[k] = clean.length > MAX_VALUE_CHARS ? clean.slice(0, MAX_VALUE_CHARS) : clean",
    to: "      out[k] = stripUrlSecrets(v.length > MAX_VALUE_CHARS ? v.slice(0, MAX_VALUE_CHARS) : v)" },
  ],
}
