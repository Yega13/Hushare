// Mutation set for how src/app/api/cron/error-alert/route.ts READS the error log -- run with:
//   node scripts/mutations/run.mjs error-alert-read
//
// lib/server/read-with-retry decides how a failed read is retried and is proven there. This proves
// the alarm actually uses it: without it, every one-second database gateway blip at :00 or :30 is an
// error row in the panel, which is how 13 of the last 17 error rows came to be one broken watchdog.
export default {
  file: 'src/app/api/cron/error-alert/route.ts',
  test: 'tests/route-wiring-error-alert.test.ts',
  mutations: [
    { name: 'THE ALARM READS WITHOUT A RETRY -- every gateway blip files an error row again',
      from: "import { readWithRetry } from '@/lib/server/read-with-retry'",
      to: "const readWithRetry = async <T,>(read: () => PromiseLike<T>) => ({ result: await read(), attempts: 1 })" },
    { name: 'a read that failed on both attempts is treated as an empty log, so a blind alarm reports all-clear',
      from: '  if (error) {\n    return serverError(', to: '  if (false) {\n    return serverError(' },
  ],
}
