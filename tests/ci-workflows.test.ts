import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// THE WORKFLOWS, WHICH NOTHING HAS EVER TESTED.
//
// Every other guard in this repo is enforced by something. These four are enforced by a comment,
// and on 2026-09-12 one of them was found to have been wrong for seventeen days: backup.yml said
// "CHECKED BEFORE THE DUMP, not after it" directly above a step that ran AFTER the dump, because it
// was appended rather than inserted when it was written (6999c0a, 2026-08-26). The comment was not
// merely wrong, it was reassuring -- anyone opening the file read it and stopped looking, which is
// exactly why it survived. MISTAKES entry 111 is this shape; that was the third instance.
//
// WHY TEXT POSITION AND NOT A PARSED STEP LIST. GitHub runs steps in the order they appear in the
// file, so the position of the line IS the property. No YAML parser is a direct dependency here
// (js-yaml is only present transitively, via eslint), and a test that breaks when eslint reshuffles
// its own dependencies would be a test nobody trusts. Every marker below is asserted to appear
// EXACTLY ONCE at its real indentation, so a commented-out or duplicated line cannot satisfy one.

const read = (name: string) => readFileSync(join(process.cwd(), '.github', 'workflows', name), 'utf8')

/** The character offset of a step header that must appear exactly once. */
function stepAt(source: string, name: string): number {
  const marker = `      - name: ${name}`
  const count = source.split(marker).length - 1
  expect(count, `"${name}" must appear exactly once as a step header`).toBe(1)
  return source.indexOf(marker)
}

describe('the nightly backup runs its steps in the only order that helps', () => {
  const backup = read('backup.yml')

  it('checks the secrets BEFORE making a dump, which is what its own comment claims', () => {
    // The cost when this is wrong: every run makes a full database dump and only then discovers a
    // missing R2 secret, so the log names the real problem at the second-to-last line instead of
    // the first. That is how two nights of backups failed unnoticed in August.
    const check = stepAt(backup, 'Check the secrets exist before doing any work')
    const dump = stepAt(backup, 'Dump the database')
    expect(check, 'the secrets check must come before the dump').toBeLessThan(dump)
  })

  it('verifies the recovery file LAST, after the backup has actually been taken', () => {
    // Deliberate, and the reverse is worse than it looks: a stale schema.sql failing BEFORE the
    // upload would mean a night with no backup at all, because a recovery file was out of date.
    const upload = stepAt(backup, 'Upload to R2 and prune old copies')
    const verify = stepAt(backup, 'Verify schema.sql still matches the live database')
    expect(verify, 'the schema check must run after the upload').toBeGreaterThan(upload)
  })

  it('never uploads the dump as a GitHub artifact', () => {
    // A dump holds every owner token and every album password hash, and artifacts on a public
    // repository can be downloaded by anyone. This job exists to protect exactly what that would
    // publish. The file says so in a comment; this is the part that enforces it.
    //
    // COMMENTS STRIPPED FIRST, and this test caught itself needing that: the file's own comment
    // reads "DELIBERATELY no actions/upload-artifact step", so a bare substring check failed on the
    // sentence promising the thing was absent. Worse, the same check would have PASSED if someone
    // added the real step and removed the comment while doing it.
    const directives = backup.split('\n').filter((l) => !l.trimStart().startsWith('#'))
    const offender = directives.find((l) => l.includes('upload-artifact'))
    expect(offender, 'a dump must never be published as a downloadable artifact').toBeUndefined()
  })
})

describe('the deploy fails on the drift that is load-bearing, and not on the one that is not', () => {
  const deploy = read('deploy.yml')

  it('src/types/database.ts drift stops the deploy', () => {
    // It is load-bearing at runtime: if it claims a column that was dropped, the code compiles, the
    // query returns nothing, and a guest sees an empty album at an event.
    expect(deploy).toMatch(/database\.ts has drifted[^']*'; exit 1/)
  })

  it('schema.sql drift does NOT stop the deploy, on purpose', () => {
    // The asymmetry is the point, and it is one an audit has already changed once. schema.sql is a
    // RECOVERY artifact: stale, it costs a bad afternoon after a disaster, and blocking on it would
    // block shipping a fix during an incident. Making this one fatal would be a regression, not a
    // tightening -- so it is pinned here with the reason, and it is fatal in backup.yml instead,
    // where failing costs nobody a deploy.
    const line = deploy.split('\n').find((l) => l.includes('dump-schema.mjs --check'))
    expect(line, 'deploy.yml must still run the schema.sql check').toBeTruthy()
    expect(line, 'the deploy must not exit on schema.sql drift').not.toContain('exit 1')
  })
})
