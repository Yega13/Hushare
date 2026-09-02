// A GREEN TEST RUN THAT DID NOT RUN EVERY TEST IS NOT A GREEN TEST RUN.
//
// vitest can drop whole test files and still exit 0. Observed on this repo while three review
// agents were running in parallel:
//
//     Test Files  62 passed (62)
//          Tests  880 passed (880)
//         Errors  3 errors
//     [exited with code 0]
//
// Three jsdom files never started — "Timeout waiting for worker to respond" — and the command
// reported success. The count in the summary is the count of files that RAN, so "62 passed (62)"
// looks complete: there is nothing on screen to compare it against. Twenty-one tests silently did
// not execute.
//
// The mechanism, verified in the installed vitest (dist/chunks/cli-api.*.js): WORKER_START_TIMEOUT
// is hardcoded to 9e4 and is not exposed through any config option, and the pool swallows the
// start rejection onto a trace span rather than failing the run. Under load a jsdom worker can
// exceed 90 seconds to start. Load is the NORMAL condition here — AGENTS.md rule 27 mandates
// running one to three breaking agents in parallel, and every one of them runs this suite.
//
// WHY THIS OUTRANKS ALMOST ANYTHING ELSE IN THE REPO. Rule 16 says break the code and watch the
// test fail. The entire method rests on being able to tell a surviving mutation from a test that
// never ran — and a runner that drops files while exiting 0 makes those two things identical. Every
// mutation result gathered before this guard existed carries that doubt, including the ones used to
// argue that a fix was safe.
//
// This cannot be a test. A file that never ran cannot assert that it did not run, so the check has
// to live outside vitest and count from the filesystem.

import { readdirSync, readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const TESTS_DIR = 'tests'

/** Every test file on disk, matching vitest.config.mts's `include` globs. */
function testFilesOnDisk(dir = TESTS_DIR) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...testFilesOnDisk(full))
    // CASE-INSENSITIVE on purpose, and it is not tidiness. vitest's include glob matches
    // `.test.ts` in lowercase only, so a file saved as `Foo.Test.ts` is run by nobody — and with a
    // case-SENSITIVE disk check here, this script counted it as absent too, printed
    // "verified: all N of N test files ran", and exited 0 with a failing test sitting on disk that
    // neither side had ever looked at. Windows makes that easy to do by accident.
    //
    // Matching it here means the counts disagree and the run FAILS, naming the file. That is the
    // right outcome: the fix is to rename it, and until then the suite must not claim to be whole.
    else if (/\.test\.tsx?$/i.test(entry.name)) out.push(full)
  }
  return out
}

const expected = testFilesOnDisk()
if (expected.length === 0) {
  // "No test files found" is the OTHER way a run can look like a pass. It has already produced a
  // false proof in this repo twice: vitest exits non-zero for it, which reads exactly like a
  // caught mutation.
  console.error('[run-tests] FAILED: no test files found on disk at all.')
  process.exit(1)
}

const scratch = mkdtempSync(join(tmpdir(), 'hushare-tests-'))
const jsonPath = join(scratch, 'results.json')

// Pass through any extra args (a file filter, -t, etc.) so this stays a drop-in for `vitest run`.
const passthrough = process.argv.slice(2)
const result = spawnSync(
  process.execPath,
  [join('node_modules', 'vitest', 'vitest.mjs'), 'run',
    '--reporter=default', '--reporter=json', `--outputFile=${jsonPath}`, ...passthrough],
  { stdio: 'inherit' },
)

// A FILTERED RUN CANNOT BE COMPLETENESS-CHECKED, and must not pretend to be. `npm test -- foo` is
// meant to run one file; comparing that against the whole directory would fail every time and the
// check would be turned off within a day.
//
// A FLAG IS NOT A FILTER, and treating it as one disabled the guard in silence. This used to skip
// the check whenever ANY argument was present, so `npm test -- --coverage`, `--bail`, `-u` or
// `--reporter=verbose` all turned it off — and printed nothing at all, so a guarded run and an
// unguarded one differed only by the ABSENCE of a line. That is rule 20's own shape, inside the
// file written to enforce rule 20.
//
// Only a non-flag argument narrows which files run. Flags are passed through and still checked.
const fileFilters = passthrough.filter((a) => !a.startsWith('-'))
if (fileFilters.length > 0) {
  // Said out loud, every time. The whole failure above was a guard that went quiet.
  console.log(`[run-tests] completeness check SKIPPED — filtered to: ${fileFilters.join(' ')}`)
  console.log('[run-tests] run `npm test` with no file argument before believing a green suite.')
  rmSync(scratch, { recursive: true, force: true })
  process.exit(result.status ?? 1)
}

let report
try {
  report = JSON.parse(readFileSync(jsonPath, 'utf8'))
} catch {
  // No parseable report means we cannot prove anything about what ran. That is a failure, never a
  // pass — refusing to give a verdict is the whole point of this file.
  console.error('[run-tests] FAILED: vitest produced no readable JSON report.')
  console.error('[run-tests] Cannot verify which test files ran, so this run is not trustworthy.')
  rmSync(scratch, { recursive: true, force: true })
  process.exit(1)
}
rmSync(scratch, { recursive: true, force: true })

// Normalise both sides to a comparable suffix: the report carries absolute paths with the
// platform's separator, the disk walk carries repo-relative ones.
const norm = (p) => p.split(sep).join('/').replace(/^.*?\/(tests\/)/, '$1')
const ran = new Set((report.testResults ?? []).map((r) => norm(r.name)))
const missing = expected.map(norm).filter((f) => !ran.has(f))

if (missing.length > 0) {
  console.error('')
  console.error('[run-tests] FAILED: vitest exited without running every test file.')
  console.error(`[run-tests] ${expected.length} test files on disk, ${ran.size} produced results.`)
  console.error('[run-tests] Never ran:')
  for (const f of missing) console.error(`    ${f}`)
  console.error('')
  console.error('[run-tests] This is usually a worker that took longer than vitest\'s hardcoded 90s')
  console.error('[run-tests] start timeout, which vitest reports as an "error" while still exiting 0.')
  console.error('[run-tests] Re-run with less load. Do NOT treat the previous summary as a pass, and')
  console.error('[run-tests] do NOT read a mutation as "survived" from a run that looked like this.')
  process.exit(1)
}

if (result.status !== 0) process.exit(result.status ?? 1)

// ran.size, NOT expected.length. Printing the disk count states a number this line never
// compared — and with the guard above disabled it cheerfully reported "verified: all 67 test
// files ran" while one had. Rule 20, inside the file written to enforce rule 20.
console.log(`[run-tests] verified: all ${ran.size} of ${expected.length} test files ran.`)
