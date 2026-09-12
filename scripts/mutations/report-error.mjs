// Mutation set for src/lib/report-error.ts -- run with: node scripts/mutations/run.mjs report-error
//
// What a browser sends about an error, and whether it sends it at all. Both halves come from one
// iPhone on 2026-09-10: an owner's key left the browser inside a report, and two errors from a
// script that was not ours were filed as our errors.
//
// NOT MUTATED -- documentLineCount's catch returning MAX_SAFE_INTEGER. jsdom's outerHTML does not
// throw, so no test can reach the branch; its direction is stated beside it (a count that cannot be
// taken filters nothing), and the pure function's MAX case is tested directly.
// NOT MUTATED -- the line-validity guard in isOutsideOurDocument. Every comparison with undefined or
// NaN is already false, so deleting it is output-identical; it stays for the type checker.
export default {
  file: 'src/lib/report-error.ts',
  test: 'tests/limits-and-classifiers.test.ts tests/error-report-secrets.test.ts tests/error-context.test.ts',
  mutations: [
  { name: "AN OWNER'S KEY LEAVES THE BROWSER AGAIN: the report body is sent unstripped",
    from: "      body: stripUrlSecrets(JSON.stringify({", to: "      body: (JSON.stringify({" },
  { name: 'THE INJECTED-SCRIPT FILTER IS NOT WIRED, so Chrome on iPhone fills the Errors tab again',
    from: "      isOutsideOurDocument(e.filename, e.lineno, { url: window.location.href, lineCount: documentLineCount })",
    to: "      false" },
  { name: 'a file with no URL is kept, so "undefined" is filed as our error',
    from: "  if (!/^[a-z][a-z0-9+.-]*:/i.test(file)) return true", to: "  if (false) return true" },
  { name: 'the slack is gone, so our own inline script near the end of the page is filed as foreign',
    from: "  return line > doc.lineCount() + DOCUMENT_LINE_SLACK", to: "  return line > doc.lineCount()" },
  { name: 'the slack is off by one',
    from: "  return line > doc.lineCount() + DOCUMENT_LINE_SLACK", to: "  return line >= doc.lineCount() + DOCUMENT_LINE_SLACK" },
  { name: 'any page counts as this document, so a line past the end of ANOTHER file is dropped',
    from: "  if (withoutQueryOrFragment(file) !== withoutQueryOrFragment(doc.url)) return false", to: "" },
  { name: 'the fragment is compared too, so an owner link never matches its own page',
    from: "  if (withoutQueryOrFragment(file) !== withoutQueryOrFragment(doc.url)) return false", to: "  if (file !== doc.url) return false" },
  { name: 'the fragment is kept when comparing',
    from: "  const cut = url.search(/[?#]/)", to: "  const cut = -1" },
  { name: 'an empty filename is dropped as foreign',
    from: "  if (!file) return false", to: "  if (!file) return true" },
  ],
}
