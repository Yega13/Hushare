// FAILS THE BUILD ON A CONDITIONALLY-CALLED REACT HOOK -- and, since 2026-09-07, on ANY lint
// finding beyond the count frozen in scripts/lint-budget.json (see the ratchet at the bottom).
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
// (set-state-in-effect, refs, exhaustive-deps) inside four large components, and a gate that fails
// on everything is a gate somebody turns off. So the blocking set is ONLY the class that crashes a page for a customer,
// and the rest is a BUDGET: today's count per rule, which may only fall. That turns "visible as
// debt" into "cannot grow" without asking anyone to pay 80 findings at once.
//
// Exit 1 with the offending file, line and message, so a failed deploy says what to fix.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Newline via fromCharCode: this file needs no escape that could be mangled on the way to disk.
const NL = String.fromCharCode(10)

const BLOCKING = new Set(['react-hooks/rules-of-hooks'])

// WHAT GETS SCANNED. `src` alone until 2026-09-10, which left the tooling and the tests outside the
// ratchet entirely: a whole-repo run that day found 50 findings nothing was gating, all of them in
// scripts/ and tests/. They are fixed, and the scan now covers the directories they were in, so the
// next one cannot arrive unnoticed. Named explicitly rather than passing '.' -- eslint walks
// everything not ignored, and the point is to say which trees are held rather than to discover it.
// Costs about 75 seconds; `src` is 55 of them.
const SCAN = ['src', 'scripts', 'tests']

let raw = ''
try {
  raw = execFileSync('npx', ['eslint', ...SCAN, '-f', 'json'], {
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

// THE RATCHET FOR EVERYTHING ELSE. Every other rule's count is frozen in scripts/lint-budget.json
// (measured 2026-09-07: 91 findings, 79 of them react-hooks rules inside the four largest
// components). A count going UP fails the deploy -- new debt is not accepted quietly. A count going
// DOWN also fails, until the budget is lowered to match: a reduction is recorded, never left as
// slack for the next regression to hide in. Same discipline as SIZE_BUDGET in
// tests/architecture.test.ts, for the same reason: a number that can only fall is the only kind that
// actually holds.
//
// A rule missing from the budget is budgeted at ZERO: a new rule, or a first finding under an old
// one, is a decision somebody makes in that file, not something that lands by accident.
const budgetPath = join(dirname(fileURLToPath(import.meta.url)), 'lint-budget.json')
const budget = JSON.parse(readFileSync(budgetPath, 'utf8'))

const counts = {}
for (const file of results) {
  for (const m of file.messages) {
    if (BLOCKING.has(m.ruleId)) continue
    // A finding with no rule is an unused eslint-disable directive: a comment claiming a
    // problem that is no longer there. Four of those sat outside the ratchet for weeks.
    const rule = m.ruleId ?? 'unused-disable-directive'
    counts[rule] = (counts[rule] ?? 0) + 1
  }
}
const rules = new Set([...Object.keys(budget), ...Object.keys(counts)])
const over = []
const under = []
for (const rule of [...rules].sort()) {
  const have = counts[rule] ?? 0
  const allowed = budget[rule] ?? 0
  if (have > allowed) over.push(`${rule}: ${have} (budget ${allowed})`)
  else if (have < allowed) under.push(`${rule}: ${have} (budget ${allowed})`)
}
if (over.length) {
  console.error(`[check-hooks] lint debt went UP:` + NL + '  ' + over.join(NL + '  '))
  console.error('Fix the new finding, or raise the number in scripts/lint-budget.json in the same')
  console.error('commit with a sentence saying why -- a deliberate line, not a file quietly growing.')
  process.exit(1)
}
if (under.length) {
  console.error(`[check-hooks] lint debt went DOWN and the budget was not lowered:` + NL + '  ' + under.join(NL + '  '))
  console.error('Lower scripts/lint-budget.json to the new counts so the reduction is kept.')
  process.exit(1)
}
console.log(`[check-hooks] ✓ lint debt within budget (${Object.values(counts).reduce((a, b) => a + b, 0)} findings across ${rules.size} rules).`)
