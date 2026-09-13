// Mutation set for src/lib/optional-load.ts -- run with:
//   node scripts/mutations/run.mjs optional-load
//
// What an optional part of the album page does, and reports, when it fails. Every mutation below
// leaves the page behaving plausibly -- and each one either reloads a guest's album again, blanks it
// again, loses the only evidence of an unexplained failure, hides a new bug inside an old row, or
// takes deploy self-healing away from everyone with an old tab open.
export default {
  file: 'src/lib/optional-load.ts',
  test: 'tests/optional-load.test.ts',
  mutations: [
    // ── a load failure: what is reported ──────────────────────────────────────────────────────
    { name: "THE ERROR'S OWN WORDS ARE REPORTED, which matches the chunk rule and reloads the album again",
      from: "    message: `Optional part could not load: ${part}`,", to: "    message: detail," },
    { name: 'the original words are dropped, erasing the only evidence of an unexplained failure',
      from: "    context: reloading ? { cause, detail, autoReloaded: true } : { cause, detail },",
      to: "    context: reloading ? { cause, autoReloaded: true } : { cause }," },
    { name: 'a reload is never recorded, so /admin cannot tell a healed deploy from a lost panel',
      from: "    context: reloading ? { cause, detail, autoReloaded: true } : { cause, detail },",
      to: "    context: { cause, detail }," },
    { name: 'every failure is a warning, so a guest who cannot upload never reaches the alert threshold',
      from: "    level: reloading || part === 'qr' ? 'warn' : 'error',", to: "    level: 'warn'," },
    { name: 'every failure is an error, so a missing QR picture counts like a missing upload panel',
      from: "    level: reloading || part === 'qr' ? 'warn' : 'error',", to: "    level: 'error'," },
    { name: 'a stale deploy that healed itself is filed as a guest who lost a panel',
      from: "    level: reloading || part === 'qr' ? 'warn' : 'error',", to: "    level: part === 'qr' ? 'warn' : 'error'," },
    { name: 'the kept detail is unbounded',
      from: "export const DETAIL_MAX = 200", to: "export const DETAIL_MAX = 100000" },
    { name: 'the source stops naming the part, so the panel cannot say which one broke',
      from: "  const source = `optional:${part}`", to: "  const source = 'optional'" },
    { name: 'a non-Error rejection loses its words',
      from: "  return error instanceof Error ? error.message : String(error)", to: "  return error instanceof Error ? error.message : ''" },
    { name: 'a load failure marks itself fatal, so a translated page reloads under the album',
      from: "    source,\n    // One stable sentence", to: "    source,\n    fatal: true,\n    // One stable sentence" },

    // ── a crash: what is reported ─────────────────────────────────────────────────────────────
    { name: 'A CRASH IS FILED AS A LOAD FAILURE -- every new bug merges into the chunk incident row',
      from: "  if (!isLoadFailure(error)) {", to: "  if (false) {" },
    { name: "a crash drops its words, so every bug in a panel is one row and report-error's DOM rule is blind",
      from: "      message: `Optional part crashed: ${part}: ${errorText(error)}`,", to: "      message: `Optional part crashed: ${part}`," },
    { name: 'the error name joins the message, adding chunk words the classifier never checked',
      from: "${part}: ${errorText(error)}`", to: "${part}: ${cause}: ${errorText(error)}`" },
    { name: 'every crash is a warning, so a broken upload panel never reaches the alert threshold',
      from: "      level: part === 'qr' ? 'warn' : 'error',", to: "      level: 'warn'," },
    { name: 'every crash is an error, including a missing QR picture',
      from: "      level: part === 'qr' ? 'warn' : 'error',", to: "      level: 'error'," },
    { name: 'a crash loses its stack',
      from: "        stack: error instanceof Error ? stackFrames(error.stack) : undefined,", to: "        stack: undefined," },
    { name: 'a crash keeps the raw stack, message line and all, unbounded',
      from: "stackFrames(error.stack)", to: "error.stack" },
    { name: 'a crash loses the component that threw',
      from: "        componentStack: componentStack?.trim().slice(0, COMPONENT_STACK_MAX) || undefined,", to: "        componentStack: undefined," },
    { name: "the component stack keeps React's leading blank line",
      from: ".trim().slice(0, COMPONENT_STACK_MAX)", to: ".slice(0, COMPONENT_STACK_MAX)" },
    { name: 'the component stack is unbounded, so the log route drops the whole context',
      from: "export const COMPONENT_STACK_MAX = 200", to: "export const COMPONENT_STACK_MAX = 100000" },
    { name: 'a crash marks itself fatal, so report-error reloads a page whose album is still on screen',
      from: "      source,\n      message: `Optional part crashed", to: "      source,\n      fatal: true,\n      message: `Optional part crashed" },

    // ── reload or contain ─────────────────────────────────────────────────────────────────────
    { name: 'THE QR CODE RELOADS THE ALBUM AGAIN -- a picture beside a link, worth the whole page',
      from: "  if (part === 'qr') return false\n", to: "" },
    { name: 'A SPENT RELOAD IS SPENT AGAIN, so the device that cannot fetch the chunk loops',
      from: "  if (!reloadAvailable) return false\n", to: "" },
    { name: 'a panel with an ordinary bug reloads the page, losing the guest for nothing',
      from: "  return isLoadFailure(error)", to: "  return true" },
    { name: 'nothing ever reloads, so a real stale deploy no longer heals itself',
      from: "  return isLoadFailure(error)", to: "  return false" },
    { name: 'nothing is ever a load failure: every chunk failure is filed as a crash in chunk words',
      from: "  return looksLikeStaleDeploy(errorText(error))", to: "  return false" },
  ],
}
