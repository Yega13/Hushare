// WHICH MUTATION SETS THIS INVOCATION RUNS -- the decision, on its own, so it can be tested.
//
// It lived inside run.mjs and it was wrong on its first run: `--shard 1/6` left the string "1/6" in
// the list of requested set names, so shards 2 through 6 selected nothing and exited 0. A CI job
// that runs no mutations and reports success is worse than no CI job, because the green tick is
// read as proof. Nothing about that is visible from the outside -- which is exactly the kind of
// decision that belongs out of the script and behind a test (rule 14).

/**
 * @param {string[]} available  every set name, sorted
 * @param {string[]} argv       the arguments after the script name
 * @returns {{ names: string[], shard: {k: number, n: number} | null, list: boolean, recoverOnly: boolean, error: string | null }}
 */
export function selectSets(available, argv) {
  let shardSpec = null
  let unknownFlag = null
  const requested = []
  // One pass, so a flag's own VALUE can never be read as a positional argument. Two passes is how
  // "1/6" became a set name.
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--shard') { shardSpec = argv[++i] ?? ''; continue }
    if (a.startsWith('--shard=')) { shardSpec = a.slice('--shard='.length); continue }
    // AN UNKNOWN FLAG IS AN ERROR, NOT SOMETHING TO IGNORE. Filtering them out is how
    // `run.mjs --list-only` -- a flag that does not exist -- silently ran all 51 sets instead of
    // printing a list, and the run had to be killed, which left a mutant on disk (MISTAKES 97).
    if (a === '--list' || a === '--recover-only') continue
    if (a.startsWith('--')) { unknownFlag = a; continue }
    requested.push(a)
  }

  if (unknownFlag) {
    return { names: [], shard: null, list: false, recoverOnly: false, error: `unknown option: ${unknownFlag}` }
  }
  const list = argv.includes('--list')
  const recoverOnly = argv.includes('--recover-only')
  let names = requested.length ? requested : available
  let shard = null

  if (shardSpec !== null) {
    const parts = String(shardSpec).split('/')
    const k = Number(parts[0])
    const n = Number(parts[1])
    if (parts.length !== 2 || !Number.isInteger(k) || !Number.isInteger(n) || n < 1 || k < 1 || k > n) {
      return { names: [], shard: null, list, recoverOnly, error: `--shard takes k/n with 1 <= k <= n, got: ${shardSpec}` }
    }
    // ROUND-ROBIN OVER THE SORTED LIST, not contiguous blocks. The sets differ enormously in cost --
    // restore-core boots a real Postgres, upload-policy runs three test files 45 times -- so
    // interleaving spreads the expensive ones instead of stacking them into one shard. It also
    // guarantees no shard is empty while n <= available.length, which contiguous blocks do not.
    names = names.filter((_name, i) => i % n === k - 1)
    shard = { k, n }
  }

  const unknown = names.find((n) => !available.includes(n))
  if (unknown) return { names: [], shard, list, recoverOnly, error: `no such mutation set: ${unknown} (have: ${available.join(', ')})` }
  if (!list && !recoverOnly && names.length === 0) {
    return { names: [], shard, list, recoverOnly, error: 'no mutation sets selected' }
  }
  return { names, shard, list, recoverOnly, error: null }
}
