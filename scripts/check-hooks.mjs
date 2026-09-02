// FAILS THE BUILD ON A CONDITIONALLY-CALLED REACT HOOK. Nothing else.
//
//   node scripts/check-hooks.mjs
//
// WHY THIS EXISTS AS ITS OWN GATE. On 2026-09-02 a guest unlocking a password-protected album got
// "Something went wrong" instead of the album. The cause was five useMemo calls sitting after an
// early return in AlbumPageClient: on an ordinary album `initialAlbum` is seeded by the server so
// all five run from the first render and nothing is wrong, but a GATED album is server-rendered as
// the password prompt, so the first render takes the early return and calls five fewer hooks. When
// the password is accepted and the album arrives, all five run, React counts more hooks than the
// previous render, and throws — React error #310. Eight of the 105 live albums are gated.
//
// It survived review, the type checker, the whole test suite and two adversarial rounds. It could
// not survive `react-hooks/rules-of-hooks`, which named all five in one run. The rule was installed
// the entire time; nothing ran it.
//
// WHY NOT JUST RUN `npm run lint` IN CI. Because it reports ~80 other react-hooks findings today
// (set-state-in-effect, refs, exhaustive-deps), and a gate that fails on everything is a gate
// somebody turns off. This is a ratchet in the same spirit as tests/architecture.test.ts: it fails
// ONLY on the class that crashes a page for a customer, and the rest stays visible in `npm run lint`
// as debt. Widen it deliberately, when the debt is paid — not by accident.
//
// Exit 1 with the offending file, line and message, so a failed deploy says what to fix.

import { execFileSync } from 'node:child_process'

const BLOCKING = new Set(['react-hooks/rules-of-hooks'])

let raw = ''
try {
  raw = execFileSync('npx', ['eslint', 'src', '-f', 'json'], {
    encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024,
  })
} catch (err) {
  // eslint exits non-zero whenever it reports anything at all, including the findings this gate
  // deliberately ignores. Its JSON is still on stdout, so that is the exit code to look past — but
  // an EMPTY stdout means eslint itself failed to run, which must not read as "no violations".
  raw = err.stdout ?? ''
  if (!raw.trim()) {
    console.error('[check-hooks] eslint did not run:', err.message)
    process.exit(1)
  }
}

let results
try {
  results = JSON.parse(raw)
} catch {
  console.error('[check-hooks] could not parse eslint output — treating as a failure, not a pass.')
  process.exit(1)
}

if (!Array.isArray(results) || results.length === 0) {
  console.error('[check-hooks] eslint reported on ZERO files — the scan is broken, not the code.')
  process.exit(1)
}

const offences = []
for (const file of results) {
  for (const m of file.messages) {
    if (BLOCKING.has(m.ruleId)) {
      offences.push(`${file.filePath}:${m.line}:${m.column}\n    ${m.message}`)
    }
  }
}

if (offences.length > 0) {
  console.error(`[check-hooks] ${offences.length} conditionally-called hook(s):\n`)
  for (const o of offences) console.error(o + '\n')
  console.error('A hook after an early return crashes the page with React #310 the first time the')
  console.error('early return stops being taken. Move it above every return in the component.')
  process.exit(1)
}

console.log(`[check-hooks] ✓ no conditionally-called hooks (${results.length} files scanned).`)
