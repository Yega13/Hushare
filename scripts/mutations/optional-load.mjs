// Mutation set for src/lib/optional-load.ts -- run with:
//   node scripts/mutations/run.mjs optional-load
//
// What an optional part of the album page does, and reports, when its code will not load. Every
// mutation below leaves the page behaving plausibly -- and each one either reloads a guest's album
// again, blanks it again, loses the only evidence of an unexplained failure, or takes deploy
// self-healing away from everyone with an old tab open.
export default {
  file: 'src/lib/optional-load.ts',
  test: 'tests/optional-load.test.ts',
  mutations: [
    // ── what is reported ──────────────────────────────────────────────────────────────────────
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
      from: "    source: `optional:${part}`,", to: "    source: 'optional'," },
    { name: 'a non-Error rejection loses its words',
      from: "  const detail = (error instanceof Error ? error.message : String(error)).slice(0, DETAIL_MAX)",
      to: "  const detail = (error instanceof Error ? error.message : '').slice(0, DETAIL_MAX)" },

    // ── reload or contain ─────────────────────────────────────────────────────────────────────
    { name: 'THE QR CODE RELOADS THE ALBUM AGAIN -- a picture beside a link, worth the whole page',
      from: "  if (part === 'qr') return false\n", to: "" },
    { name: 'A SPENT RELOAD IS SPENT AGAIN, so the device that cannot fetch the chunk loops',
      from: "  if (!reloadAvailable) return false\n", to: "" },
    { name: 'a panel with an ordinary bug reloads the page, losing the guest for nothing',
      from: "  return looksLikeStaleDeploy(message)", to: "  return true" },
    { name: 'nothing ever reloads, so a real stale deploy no longer heals itself',
      from: "  return looksLikeStaleDeploy(message)", to: "  return false" },
  ],
}
