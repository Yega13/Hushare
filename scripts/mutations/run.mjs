// MUTATION RUNNER -- rule 16, made reproducible.
//
//   node scripts/mutations/run.mjs                 run every set in this directory
//   node scripts/mutations/run.mjs retry http      run the named sets
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
// THE FILE IS ALWAYS RESTORED. The original text is captured before anything runs and written back
// in a `finally`, on SIGINT, and again after the loop with a byte comparison -- the scratch
// harnesses this replaces restored only at the end, so a crash mid-run left a mutant on disk.
//
// This lives in the repository rather than a scratchpad so a mutation result can be re-run by
// anyone, and so a test that quietly weakens is caught the next time someone runs its set.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')

const requested = process.argv.slice(2)
const available = readdirSync(here).filter((f) => f.endsWith('.mjs') && f !== 'run.mjs').map((f) => basename(f, '.mjs')).sort()
const names = requested.length ? requested : available
for (const n of names) {
  if (!available.includes(n)) { console.error(`no such mutation set: ${n} (have: ${available.join(', ')})`); process.exit(2) }
}

let failed = false
for (const name of names) {
  const set = (await import(pathToFileURL(join(here, `${name}.mjs`)).href)).default
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
  const restore = () => writeFileSync(target, original)
  process.once('SIGINT', () => { restore(); process.exit(130) })
  console.log(`\n== ${name}: ${set.file} <- ${set.test} (${set.mutations.length} mutations)`)
  try {
    for (const m of set.mutations) {
      const occurrences = text.split(m.from).length - 1
      if (occurrences === 0) { console.log(`DID NOT APPLY  ${m.name}`); failed = true; continue }
      if (occurrences > 1) { console.log(`AMBIGUOUS (${occurrences} matches)  ${m.name}`); failed = true; continue }
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
