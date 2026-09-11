import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { selectSets } from '../scripts/mutations/select.mjs'

// THE RUNNER THAT DECIDES WHETHER EVERY OTHER TEST IS WORTH BELIEVING.
//
// 766 mutations across 52 sets rest on this script, and its two newest features fail SILENTLY when
// they are wrong -- the worst shape a test tool can have:
//
//   --shard k/n splits the suite across parallel CI jobs. A shard that selects nothing still exits
//   0. On the first run, `--shard 1/6` left the string "1/6" in the list of requested set names, so
//   five of six shards ran no mutations at all and every one of them reported success.
//
//   The crash recovery puts back a file that a KILLED run left mutated. On 2026-09-10 a background
//   run was stopped and left src/lib/media-settings-diff.ts holding `const carried = {}` in
//   revertMediaSave -- which throws away a guest's in-flight settings on a failed save. It
//   type-checks. It reads as ordinary code. It was found only because `git status` happened to be
//   read within the minute.
//
//   And the FIRST version of that recovery made things worse rather than better. Two sessions share
//   this checkout; with one fixed note filename, a run starting while another was mid-set restored
//   the file the other was testing and deleted its note. The mutation vanished from under a running
//   vitest, the tests passed, and two mutations that had been killed an hour earlier were reported
//   SURVIVED. A recovery that invents survivors is worse than none: a survivor is a finding, and
//   somebody spends an afternoon on it.

const REPO = process.cwd()
const MUT = join(REPO, 'scripts', 'mutations')
const RUN = join(MUT, 'run.mjs')
// One note per process: the pid is in the filename. A fixed name meant a second run read the
// first run's note, restored the file it was mid-test on, and manufactured two SURVIVED results.
const notePath = (pid: number) => join(MUT, `.in-flight.${pid}.json`)
const backupPath = (pid: number) => join(MUT, `.in-flight.${pid}.backup`)
// A pid that is certainly NOT running: a real process is started and waited for, so its pid is one
// the operating system has genuinely handed out and genuinely reaped. A number picked out of the
// air (999999) is fine on Windows and can collide on Linux, where pid_max is in the millions -- and
// a colliding pid would send every recovery case below down the leave-it-alone path instead, which
// is the quiet kind of wrong.
const DEAD: number = (() => {
  const done = spawnSync(process.execPath, ['-e', '0'])
  if (typeof done.pid !== 'number') throw new Error('could not obtain a reaped pid')
  return done.pid
})()
const note = (file: string, mutation: string) => JSON.stringify({ file, set: 'pretend', mutation })
// ONLY the notes this file wrote. A blanket sweep would delete the note of a mutation run happening
// in another window on this shared checkout -- and that note is the only thing standing between a
// killed run and a mutant committed by mistake. Cleaning up must not undo the thing being tested.
const clearNotes = () => {
  for (const pid of [DEAD, process.pid]) {
    rmSync(notePath(pid), { force: true })
    rmSync(backupPath(pid), { force: true })
  }
}

const AVAILABLE: string[] = readdirSync(MUT)
  .filter((f) => f.endsWith('.mjs') && f !== 'run.mjs' && f !== 'select.mjs')
  .map((f) => f.replace(/\.mjs$/, ''))
  .sort()

const run = (...args: string[]) =>
  execFileSync(process.execPath, [RUN, ...args], { cwd: REPO, encoding: 'utf8' })

const pick = (...argv: string[]) => selectSets(AVAILABLE, argv) as {
  names: string[]; shard: { k: number; n: number } | null; list: boolean; recoverOnly: boolean; error: string | null
}

afterEach(clearNotes)

describe('the set list is real', () => {
  it('has grown well past a handful, and every name is a file', () => {
    expect(AVAILABLE.length).toBeGreaterThan(20)
    expect(AVAILABLE).toContain('upload-policy')
    expect(AVAILABLE).not.toContain('run')
    expect(AVAILABLE, 'the selector itself is not a set').not.toContain('select')
  })

  it('--list prints exactly those names, so CI needs no second copy of the list', () => {
    expect(run('--list').trim().split(/\r?\n/).filter(Boolean)).toEqual(AVAILABLE)
  })
})

describe('--shard covers the suite exactly once', () => {
  it('the parts add up to the whole, for every shard count that matters', () => {
    for (const n of [1, 2, 3, 6, 7, 13, AVAILABLE.length, AVAILABLE.length + 5]) {
      const seen: string[] = []
      for (let k = 1; k <= n; k++) seen.push(...pick('--shard', `${k}/${n}`).names)
      expect(seen.slice().sort(), `${n} shards must cover every set exactly once`).toEqual(AVAILABLE)
    }
  })

  it('NO SHARD IS EMPTY while there are at least as many sets as shards', () => {
    // An empty shard is a CI job that passes having run nothing. Round-robin makes that impossible
    // up to n === the number of sets; contiguous blocks would not.
    for (const n of [2, 6, 13, AVAILABLE.length]) {
      for (let k = 1; k <= n; k++) {
        expect(pick('--shard', `${k}/${n}`).names.length, `shard ${k}/${n} is empty`).toBeGreaterThan(0)
      }
    }
  })

  it('the shard VALUE is never mistaken for a set name', () => {
    // The original bug, in both spellings. "1/6" as a requested name made every later shard empty.
    expect(pick('--shard', '2/6').error).toBeNull()
    expect(pick('--shard=3/6').error).toBeNull()
    expect(pick('--shard', '2/6').names.length).toBeGreaterThan(0)
    expect(pick('--shard=3/6').names.length).toBeGreaterThan(0)
  })

  it('shards a NAMED subset rather than silently ignoring the names', () => {
    const two = pick('upload-policy', 'video-lane', '--shard', '1/2')
    expect(two.error).toBeNull()
    expect(two.names.length).toBe(1)
    expect(AVAILABLE).toContain(two.names[0])
  })

  it('refuses a shard specification that cannot be honoured', () => {
    for (const bad of ['0/6', '7/6', '3/0', 'x/6', '3', '', '1/2/3']) {
      expect(pick('--shard', bad).error, `--shard ${bad} must be refused`).not.toBeNull()
    }
    // ...and the script exits non-zero on it, rather than running everything.
    expect(() => run('--shard', '9/6', '--recover-only')).toThrow()
  })

  it('refuses a flag it does not know, instead of ignoring it and running everything', () => {
    // How the whole incident started: `run.mjs --list-only` is not a real option, the parser
    // filtered it out, and the run fell through to "no sets named, so run all 51". It had to be
    // killed, and the kill left a mutant on disk (MISTAKES 97).
    expect(pick('--list-only').error).toContain('unknown option')
    expect(pick('--dry-run').error).toContain('unknown option')
    expect(pick('--list-only').names, 'and it selects nothing at all').toEqual([])
    expect(() => run('--list-only')).toThrow()
  })

  it('refuses a set that does not exist, even inside a shard', () => {
    expect(pick('no-such-set').error).toContain('no such mutation set')
    expect(pick('no-such-set', '--shard', '1/1').error).toContain('no such mutation set')
  })
})

describe('a killed run does not leave a mutant on disk', () => {
  const victim = join(MUT, 'run.mjs')

  it('the pid used for the dead-process cases really is dead', () => {
    // The whole describe rests on this. If DEAD were alive, every recovery case below would be
    // testing the leave-it-alone path instead and would pass for the wrong reason.
    expect(() => process.kill(DEAD, 0)).toThrow()
  })

  it('an abandoned note is acted on: the file comes back and the note is cleared', () => {
    const original = readFileSync(victim)
    try {
      writeFileSync(backupPath(DEAD), original)
      writeFileSync(notePath(DEAD), note('scripts/mutations/run.mjs', 'a mutant nobody meant to keep'))
      writeFileSync(victim, `${original.toString('utf8')}// LEFT BEHIND BY A KILLED RUN`)
      expect(readFileSync(victim).equals(original), 'the file must really differ first').toBe(false)

      run('--recover-only')

      expect(readFileSync(victim).equals(original), 'the original bytes must come back').toBe(true)
      expect(existsSync(notePath(DEAD)), 'the note is cleared once acted on').toBe(false)
      expect(existsSync(backupPath(DEAD)), 'and so is the backup').toBe(false)
    } finally {
      writeFileSync(victim, original)
    }
  })

  it('A LIVE RUN IS LEFT ALONE -- its file is SUPPOSED to be mutated right now', () => {
    // The incident, as a test. This process is alive, so a note carrying its pid stands for another
    // session's run in progress. Touching that file mid-test is what manufactured the false
    // survivors, so nothing here may be restored, and the note must still be there afterwards.
    const alive = process.pid
    const original = readFileSync(victim)
    const mutated = `${original.toString('utf8')}// A LIVE RUN IS TESTING THIS RIGHT NOW`
    try {
      writeFileSync(backupPath(alive), original)
      writeFileSync(notePath(alive), note('scripts/mutations/run.mjs', 'mid-flight'))
      writeFileSync(victim, mutated)

      const out = run('--recover-only')

      expect(readFileSync(victim).toString('utf8'), 'a live run must not be interfered with').toBe(mutated)
      expect(existsSync(notePath(alive)), 'and its note must survive').toBe(true)
      expect(out).toContain('another run')
    } finally {
      writeFileSync(victim, original)
    }
  })

  it('refuses to mutate a file another LIVE run already holds', () => {
    // Two runs on different files are normal on a shared checkout. Two on the SAME file interleave
    // writes and make both sets of results meaningless, so the second one stops instead.
    writeFileSync(backupPath(process.pid), Buffer.from('x'))
    writeFileSync(notePath(process.pid), note('src/lib/upload/video-lane.ts', 'mid-flight'))
    expect(() => run('video-lane')).toThrow()
  })

  it('refuses to continue when an abandoned note has no backup', () => {
    // Erring toward stopping: the file on disk may be a mutant with nothing to restore it from, so
    // running more mutations over it would bury the evidence (rule 19).
    writeFileSync(notePath(DEAD), note('scripts/mutations/run.mjs', 'x'))
    rmSync(backupPath(DEAD), { force: true })
    expect(() => run('--recover-only')).toThrow()
  })

  it('the note is written atomically, so a half-written one cannot exist', () => {
    // The one state the recovery cannot act on is a note that parses as nothing: it refuses rather
    // than guess which file the backup belongs to, which is safe and still leaves somebody to
    // restore by hand. That happened on 2026-09-11 -- a run killed mid-write left a blank note
    // beside a good backup, and the mutant sat in src/lib/upload/throughput.ts until the file sizes
    // were compared by hand.
    //
    // A rename on one filesystem cannot be observed half-done. The timing this protects against
    // cannot be produced by a test, so the mechanism is asserted where it lives (rule 13's remedy
    // for a fact that cannot be expressed as behaviour).
    const runner = readFileSync(RUN, 'utf8')
    expect(runner, 'the note goes to a temp name first').toContain('${SENTINEL}.tmp')
    expect(runner, 'and is put in place by a rename').toMatch(/renameSync\(`\$\{SENTINEL\}\.tmp`, SENTINEL\)/)
    expect(runner, 'never written straight to its final name').not.toMatch(/writeFileSync\(SENTINEL,/)
  })

  it('leaves no temp file behind after a normal run', () => {
    run('--recover-only')
    for (const f of readdirSync(MUT)) {
      expect(f.endsWith('.tmp'), `${f} was left behind`).toBe(false)
    }
  })

  it('a clean tree is left completely alone', () => {
    const before = readFileSync(victim)
    run('--recover-only')
    expect(readFileSync(victim).equals(before)).toBe(true)
  })
})
