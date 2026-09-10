// MUTATION RUNNER -- rule 16, made reproducible.
//
//   node scripts/mutations/run.mjs                 run every set in this directory
//   node scripts/mutations/run.mjs retry http      run the named sets
//   node scripts/mutations/run.mjs --list          print the set names, one per line
//   node scripts/mutations/run.mjs --shard 2/6     run every 6th set starting at the 2nd
//   node scripts/mutations/run.mjs --recover-only  repair a file a killed run left mutated, then stop
//
// Each set is a module next to this file exporting { file, test, mutations }, where every mutation
// is { name, from, to }: the source text `from` is replaced with `to` in `file`, the set's `test`
// file is run, and the mutation is KILLED if the tests fail or SURVIVED if they stay green. A
// survivor is either a missing test or code that cannot execute (MISTAKES.md 44, 46) -- both are
// findings, and the run exits 1 on any.
//
// THE MUTATION MUST APPLY. A `from` string that matches nothing produces a "proof" that proved
// nothing; it has done so twice (AGENTS.md rule 16). Such a mutation is reported as DID NOT APPLY
// and fails the run. A `from` that matches more than once is also refused: the mutation would land
// in a place the author did not look at.
//
// THE FILE IS ALWAYS RESTORED, INCLUDING WHEN THIS PROCESS IS KILLED. The original text is captured
// before anything runs and written back in a `finally`, on every catchable signal, and again after
// the loop with a byte comparison. For the signals that cannot be caught -- SIGKILL, a closed
// terminal, a power cut -- the intent is written to disk before the file is touched and the NEXT
// run repairs it (see the sentinel below, and the incident that put it there).
//
// This lives in the repository rather than a scratchpad so a mutation result can be re-run by
// anyone, and so a test that quietly weakens is caught the next time someone runs its set.

import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { selectSets } from './select.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')

// Built from its code point rather than written as an escape: this file is edited by scripts often
// enough that rule 24 is a live risk in it, not a theoretical one.
const NEWLINE = String.fromCharCode(10)

const argv = process.argv.slice(2)
// Every .mjs here is a set EXCEPT this script and the selector it imports. Named rather than
// detected: a file that fails to look like a set should be a loud error, not a quiet omission.
const NOT_A_SET = new Set(['run.mjs', 'select.mjs'])
const available = readdirSync(here).filter((f) => f.endsWith('.mjs') && !NOT_A_SET.has(f)).map((f) => basename(f, '.mjs')).sort()

// WHICH SETS RUN is decided in ./select.mjs, where tests/mutation-runner.test.ts can reach it.
// A shard that quietly selects nothing exits 0, so the decision cannot live where nothing observes
// it. The suite is 766 mutations across 51 sets and each one runs a real vitest: a single
// sequential pass is over an hour, which is fine nightly and impossible as a gate anyone waits for.
const chosen = selectSets(available, argv)
if (chosen.error) { console.error(chosen.error); process.exit(2) }
if (chosen.shard) console.log(`shard ${chosen.shard.k}/${chosen.shard.n}: ${chosen.names.length} of ${available.length} sets`)
// --list feeds a CI matrix from the one list, rather than a second copy in a workflow file.
if (chosen.list) { console.log(available.join(NEWLINE)); process.exit(0) }
const names = chosen.names

// ── SURVIVING A KILL, NOT JUST AN INTERRUPT ──────────────────────────────────────────────────────
//
// The `finally` and the SIGINT handler cover every way this script can decide to stop. They do not
// cover being killed: a SIGTERM from a task manager, a closed terminal, a machine losing power.
// On 2026-09-10 a background run of this script was stopped that way, and it left
// src/lib/media-settings-diff.ts holding a mutant -- `const carried = {}` in revertMediaSave, which
// discards the in-flight settings on a failed save. It type-checks, the file looks ordinary in an
// editor, and the only reason it was found is that `git status` was read within the minute. Had it
// not been, the next commit would have shipped it.
//
// So the intent to mutate is written to disk BEFORE the file is touched, with the original bytes
// beside it, and the next run restores from that before doing anything else. The recovery is not
// conditional on this process ever running again in the same shell -- any later run repairs it, and
// so does `npm run mutate -- --recover-only`.
//
// ONE NOTE PER PROCESS, AND NEVER TOUCH A LIVE ONE. Two sessions share this checkout, and the first
// version of this used a single fixed filename: a second run starting while the first was mid-set
// read the first run's note, restored the file it was in the middle of testing, and deleted the
// note -- so the mutation vanished from under a running vitest, the tests passed, and two
// mutations were reported SURVIVED that had been killed an hour earlier. A recovery mechanism that
// invents survivors is worse than none, because a survivor is a finding somebody then investigates.
//
// The pid in the filename keeps runs apart, and a note whose process is still alive is left alone.
const notePath = (pid) => join(here, `.in-flight.${pid}.json`)
const backupPath = (pid) => join(here, `.in-flight.${pid}.backup`)
const SENTINEL = notePath(process.pid)
const BACKUP = backupPath(process.pid)

const isAlive = (pid) => {
  // Signal 0 checks for existence without delivering anything. EPERM means it exists and belongs to
  // somebody else, which still counts as alive.
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

function recoverAbandoned() {
  const notes = readdirSync(here).filter((f) => /^\.in-flight\.\d+\.json$/.test(f))
  let recovered = 0
  for (const f of notes) {
    const pid = Number(f.split('.')[2])
    if (pid === process.pid) continue
    if (isAlive(pid)) {
      // Another run is working right now. Its file is SUPPOSED to be mutated at this instant.
      console.log(`[mutate] another run (pid ${pid}) is in progress; leaving its work alone.`)
      continue
    }
    let note
    try {
      note = JSON.parse(readFileSync(join(here, f), 'utf8'))
    } catch {
      console.error(`[mutate] ${f} is unreadable and its process is gone. Check git status, then delete it.`)
      process.exit(3)
    }
    const target = join(repo, note.file)
    const backup = backupPath(pid)
    if (!existsSync(backup)) {
      console.error(`[mutate] a run was killed while mutating ${note.file}, and its backup is gone.`)
      console.error(`[mutate] restore it with: git checkout -- ${note.file}`)
      process.exit(3)
    }
    const saved = readFileSync(backup)
    if (!saved.equals(readFileSync(target))) {
      writeFileSync(target, saved)
      console.error(`[mutate] RECOVERED: a killed run (pid ${pid}) left ${note.file}`)
      console.error(`[mutate] holding "${note.mutation}". The original bytes have been written back.`)
      recovered++
    }
    rmSync(join(here, f), { force: true })
    rmSync(backup, { force: true })
  }
  return recovered
}

recoverAbandoned()
if (chosen.recoverOnly) process.exit(0)

// Refuse to mutate a file another LIVE run already has open. Two runs on different files are fine
// and normal on a shared checkout; two on the same file interleave writes and both sets of results
// become meaningless.
function targetIsBusy(relFile) {
  for (const f of readdirSync(here).filter((x) => /^\.in-flight\.\d+\.json$/.test(x))) {
    const pid = Number(f.split('.')[2])
    if (pid === process.pid || !isAlive(pid)) continue
    try {
      if (JSON.parse(readFileSync(join(here, f), 'utf8')).file === relFile) return pid
    } catch { /* unreadable and alive: leave it to its owner */ }
  }
  return null
}

let failed = false
for (const name of names) {
  const set = (await import(pathToFileURL(join(here, `${name}.mjs`)).href)).default
  const busy = targetIsBusy(set.file)
  if (busy !== null) {
    console.error(`[mutate] ${set.file} is being mutated right now by pid ${busy}. Refusing ${name}:`)
    console.error('[mutate] two runs over one file interleave writes and both results become noise.')
    process.exit(4)
  }
  const target = join(repo, set.file)
  const original = readFileSync(target, 'utf8')
  // MATCH ON LF, RESTORE THE ORIGINAL BYTES. A `git checkout` under core.autocrlf=true writes a
  // file back as CRLF while the rest of the tree is LF, and git reports it clean either way. Every
  // `from` string keyed on a newline then silently fails to match -- observed on 2026-09-06: five
  // shipped mutations and all six of a reviewer's reported DID NOT APPLY against a file whose only
  // difference was its line endings. Matching is done on a normalised copy; the file is restored
  // to exactly the bytes it had.
  const CR = String.fromCharCode(13)
  const text = original.split(CR).join('')
  const restore = () => {
    writeFileSync(target, original)
    rmSync(SENTINEL, { force: true })
    rmSync(BACKUP, { force: true })
  }
  // Every signal that can reach a node process here, not just the one a person types.
  //
  // MEASURED, NOT ASSUMED: on Windows these handlers cover much less than they appear to.
  // `process.kill(pid, 'SIGTERM')` maps to TerminateProcess, which is not catchable -- tried on
  // 2026-09-10 against a real run, and the handler did not fire. The file was left mutated and only
  // the sentinel below brought it back. So the handlers are the tidy path, and the sentinel is the
  // one that actually holds.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.once(sig, () => { restore(); process.exit(130) })
  }
  console.log(`\n== ${name}: ${set.file} <- ${set.test} (${set.mutations.length} mutations)`)
  try {
    for (const m of set.mutations) {
      const occurrences = text.split(m.from).length - 1
      if (occurrences === 0) { console.log(`DID NOT APPLY  ${m.name}`); failed = true; continue }
      if (occurrences > 1) { console.log(`AMBIGUOUS (${occurrences} matches)  ${m.name}`); failed = true; continue }
      // The note and the original bytes go down FIRST. If this process dies between here and the
      // restore below, the next run reads these and puts the file back.
      writeFileSync(BACKUP, original)
      writeFileSync(SENTINEL, JSON.stringify({ file: set.file, set: name, mutation: m.name }, null, 2))
      writeFileSync(target, text.replace(m.from, m.to))
      let killed = false
      try {
        execSync(`npx vitest run ${set.test}`, { cwd: repo, stdio: 'pipe', timeout: set.timeoutMs ?? 180_000 })
      } catch {
        killed = true
      } finally {
        restore()
      }
      console.log(`${killed ? 'KILLED  ' : 'SURVIVED'}  ${m.name}`)
      if (!killed) failed = true
    }
  } finally {
    restore()
  }
  if (readFileSync(target, 'utf8') !== original) { console.error(`RESTORE FAILED for ${set.file}`); process.exit(3) }
}
console.log(failed ? '\nSOME MUTATIONS SURVIVED OR DID NOT APPLY' : '\nALL MUTATIONS KILLED')
process.exit(failed ? 1 : 0)
