// A READ THAT ONE GATEWAY BLIP SHOULD NOT TURN INTO AN ERROR ROW.
//
// Measured 2026-09-13/14: the error-alert cron, which runs every minute, filed 13 "Gateway Timeout"
// rows in 20 hours -- every one at :00 or :30 past the hour, twelve seconds after the tick, with no
// other failure recorded within five minutes of any of them. The query it runs is indexed and
// answered in about 360 ms (the same as a trivial control query) over a 1,133-row table, and nothing
// in this repository does extra work at :00 or :30. The database gateway briefly stops answering at
// those moments; why is not visible from here (there is no access to its logs).
//
// A watchdog that files every blip as an error manufactures the noise it exists to watch, and a
// single missed tick of that cron loses nothing: the next one, a minute later, reads the same window.
// So a read that fails is asked once more after a pause, and only a failure that survives the retry
// is returned as a failure. An outage is not hidden: a gateway that is really down fails both
// attempts and is reported exactly as before.
//
// Takes a FACTORY, not a query. A Supabase query builder runs when it is awaited, and awaiting the
// same builder twice is not a documented way to run it again -- each attempt builds its own.
//
// A read that THROWS is not retried and is not caught: supabase-js reports request failures as
// { error }, and anything that throws instead is left to surface the way it did before.

export const READ_RETRY_ATTEMPTS = 2
export const READ_RETRY_DELAY_MS = 3000

export async function readWithRetry<T extends { error: unknown }>(
  read: () => PromiseLike<T>,
  deps: { sleep?: (ms: number) => Promise<void>; attempts?: number; delayMs?: number } = {},
): Promise<{ result: T; attempts: number }> {
  const attempts = deps.attempts ?? READ_RETRY_ATTEMPTS
  const delayMs = deps.delayMs ?? READ_RETRY_DELAY_MS
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let result = await read()
  let made = 1
  while (result.error && made < attempts) {
    await sleep(delayMs)
    result = await read()
    made++
  }
  return { result, attempts: made }
}
