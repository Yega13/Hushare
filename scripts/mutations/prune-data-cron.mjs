// Mutation set for src/app/api/cron/prune-data/route.ts -- run with:
//   node scripts/mutations/run.mjs prune-data-cron
//
// The cron that keeps the retention periods the privacy policy publishes. Each mutation below leaves
// it returning ok -- and each one either lets a promise stop being kept without a word, turns a
// gateway blip into an error row, or deletes a live album's face data because a check failed.
export default {
  file: 'src/app/api/cron/prune-data/route.ts',
  test: 'tests/route-wiring-prune-data.test.ts',
  mutations: [
    { name: 'the presence sweep is not retried, so every :00/:30 gateway blip is an error row',
      from: "import { readWithRetry } from '@/lib/server/read-with-retry'",
      to: "const readWithRetry = async <T,>(read: () => PromiseLike<T>) => ({ result: await read(), attempts: 1 })" },
    { name: 'a presence sweep that keeps failing is not reported -- the 10-minute promise quietly lapses',
      from: "    if (error) failed('presence', error.message)\n", to: '' },
    { name: 'the IP-log retention step fails silently',
      from: "    if (error) failed('rate_limit_events', error.message)\n", to: '' },
    { name: 'the abandoned video-token step fails silently -- live credentials outlive their expiry',
      from: "    if (error) failed('pending_stream_uploads', error.message)\n", to: '' },
    { name: 'the rate-limit counter step fails silently',
      from: "    if (error) failed('rate_limit_counters', error.message)\n", to: '' },
    { name: 'the error-log retention step fails silently',
      from: "    if (error) failed('error_events', error.message)\n", to: '' },
    { name: 'a failed read of the face-collection candidates is not reported',
      from: "    if (albumsError) failed('face collection candidates', albumsError.message)\n", to: '' },
    { name: 'A FAILED RECENT-PHOTO READ MEANS "NO RECENT PHOTOS" AGAIN -- a live album loses its Face Finder',
      from: "      if (recentError) { failed('face collection recent-photo check', recentError.message, album.id); continue }\n", to: '' },
    { name: 'A FLAG THAT DID NOT GO DOWN STILL DELETES THE COLLECTION -- the indexer re-enrols every face',
      from: "        if (flag.error) { failed('face collection expiry', flag.error.message, album.id); continue }\n", to: '' },
    { name: 'face ids that could not be cleared are not reported',
      from: "        if (cleared.error) failed('face ids reset', cleared.error.message, album.id)\n", to: '' },
    { name: 'a collection that could not be deleted is not reported',
      from: "        failed('face collection expiry', msg, album.id)\n", to: '' },
    { name: 'every step reports the same sentence, so the panel cannot say which promise broke',
      from: '`Retention step failed: ${step}`', to: "'Retention step failed'" },
  ],
}
