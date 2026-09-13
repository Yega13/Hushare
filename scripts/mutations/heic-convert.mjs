// Mutation set for src/lib/upload/heic-convert.ts -- run with:
//   node scripts/mutations/run.mjs heic-convert
//
// The HEIC worker's bookkeeping, moved out of UploadZone.tsx where nothing ran it. None of these
// throws where anyone would see it: each leaves a guest's tile on "preparing", gives a photo the wrong
// answer, or leaks a timer per photo.
export default {
  file: 'src/lib/upload/heic-convert.ts',
  test: 'tests/heic-convert.test.ts',
  mutations: [
    // ── routing replies ───────────────────────────────────────────────────────────────────────────
    { name: 'a reply for an unknown photo crashes the handler instead of being ignored',
      from: '      if (!cb) return\n', to: '' },
    { name: "the worker's own error words are replaced by a generic sentence",
      from: "else cb.reject(new Error(error ?? 'HEIC conversion failed'))", to: "else cb.reject(new Error('HEIC conversion failed'))" },
    { name: 'a reply with nothing in it fails the photo with an empty message',
      from: "error ?? 'HEIC conversion failed'", to: "error ?? ''" },
    { name: 'a finished photo leaves its two-minute timer running',
      from: '      callbacks.delete(id)\n      clearTimeout(cb.timer)', to: '      callbacks.delete(id)' },

    // ── one worker, and what a crash does ─────────────────────────────────────────────────────────
    { name: 'a new worker is started for every photo',
      from: '    if (worker) return worker\n', to: '' },
    { name: 'after a crash the dead worker is kept, so every later photo waits out the timeout',
      from: '      worker = null\n', to: '' },
    { name: 'a crash fails nobody -- every waiting tile sits on "preparing" for two minutes',
      from: "cb.reject(new Error('HEIC worker crashed'))", to: 'void cb' },
    { name: 'a crash leaves the waiting photos\' timers running',
      from: "{ clearTimeout(cb.timer); cb.reject(new Error('HEIC worker crashed')) }", to: "{ cb.reject(new Error('HEIC worker crashed')) }" },
    { name: 'THE ORDER THE MOVE FIXED: the worker is fetched before the read, so a crash mid-read strands the photo',
      from: '    const buffer = await deps.readBytes(file)\n    const target = getWorker()', to: '    const target = getWorker()\n    const buffer = await deps.readBytes(file)' },

    // ── the two-minute limit ──────────────────────────────────────────────────────────────────────
    { name: 'a photo the worker never answers is never failed, so the fallback never runs',
      from: "        reject(new Error('HEIC conversion timed out'))\n", to: '' },
    { name: 'the limit is twelve seconds, which a large HEIC on a phone can need',
      from: 'export const HEIC_TIMEOUT_MS = 120_000', to: 'export const HEIC_TIMEOUT_MS = 12_000' },

    // ── the bytes ─────────────────────────────────────────────────────────────────────────────────
    { name: 'the photo bytes are copied into the worker instead of transferred',
      from: 'target.postMessage({ id, buffer }, [buffer])', to: 'target.postMessage({ id, buffer }, [])' },

    // ── the main-thread converter ─────────────────────────────────────────────────────────────────
    { name: 'the main-thread conversion quality drops to 0.5',
      from: "toType: 'image/jpeg', quality: 0.9 }", to: "toType: 'image/jpeg', quality: 0.5 }" },
    { name: 'a burst HEIC hands the pipeline an array instead of a photo',
      from: 'return Array.isArray(result) ? result[0] : result', to: 'return result as Blob' },
    { name: 'a converter that did not load fails as "is not a function"',
      from: "  if (typeof heic2any !== 'function') throw new Error('heic2any failed to load')\n", to: '' },
    // NOT MUTATED: removing `callbacks.delete(id)` from the timeout. After a timeout the entry would
    // stay in the map, but its promise is already settled and its timer has already fired, so a late
    // reply or a later crash settles nothing a second time. The only difference is a few bytes held
    // until the next crash clears the map -- no test can observe that, and none should pretend to.
  ],
}
