import { looksLikeStaleDeploy, reloadOnceForStaleDeploy, reportClientError, stackFrames, staleReloadStillAvailable, type ReportInput } from '@/lib/report-error'

// WHAT TO DO WHEN AN OPTIONAL PART OF THE ALBUM PAGE FAILS -- and what never to say about it.
//
// Measured on 2026-09-13: 26 error rows since 2026-08-22, across at least 13 builds, from guests
// whose album page failed to load two script chunks that EXIST (both answer 200 in production, and
// their content-hashed names never changed between those builds). One is the QR code library,
// imported on every guest page load with no .catch. The other belongs to the chunk group the album
// page's `import('@/components/UploadZone')` requires. What makes some devices -- nearly all
// iPhones, some Android -- fail to fetch them is not known yet.
//
// What IS known is what the failure did. Uncaught, both reached report-error, whose chunk pattern
// treats any "Failed to load chunk" as a stale deploy and reloads the page; the reload happened, the
// failure repeated, and the upload panel's second rejection reached the route error boundary and
// replaced the whole album with "Something went wrong". An optional part took the album with it.
//
// TWO KINDS OF FAILURE, TOLD APART HERE. A part whose code would not LOAD is reported in one fixed
// sentence per part, because its own words are chunk words and chunk words are what report-error
// answers with a reload. A part that loaded and then CRASHED is reported in its own words, with its
// stack -- as the route error boundary reported it before these parts were contained. Filing a crash
// under the load sentence merged every future bug into the chunk incident's row (the row keeps its
// first context), and hid a page that Chrome's translator had rewritten from report-error's DOM rule,
// which reads the message.

/**
 * Every part of the album page that may fail without the album failing with it. 'table-card' is the
 * owner's printable card download in the share menu, whose PDF library is fetched only on demand.
 */
export const OPTIONAL_PARTS = ['qr', 'upload', 'owner-toolbar', 'face-finder', 'designer', 'table-card'] as const
export type OptionalPart = (typeof OPTIONAL_PARTS)[number]

/** How much of a load failure's original words survive into the report. Enough to recognise, not enough to flood. */
export const DETAIL_MAX = 200
/**
 * How much of React's component stack a crash report keeps. Bounded because the log route drops the
 * WHOLE context when it is too large, and a crash on a translated page also carries report-error's
 * forensics beside it.
 */
export const COMPONENT_STACK_MAX = 200

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A failure to fetch the part's code, in the words report-error's reload rule knows. */
function isLoadFailure(error: unknown): boolean {
  return looksLikeStaleDeploy(errorText(error))
}

/**
 * The report for a part that failed.
 *
 * Load failure: the message is never the error's own words -- those are chunk words, and chunk words
 * are what report-error answers with a reload. The original text is kept in context, where no reload
 * rule reads it.
 *
 * Crash: the message carries the error's words, so each distinct bug gets its own row and report-error
 * can recognise a DOM rewritten under React. It can never carry chunk words: a message with those is
 * a load failure, decided first. The error's NAME is left out of the message for the same reason --
 * a name like ChunkLoadError would add words the check above never saw.
 *
 * `reloading`: this load failure is being answered with the page's one stale-deploy reload, filed at
 * warn with autoReloaded -- the same weight report-error gives a recovered stale deploy. It cannot be
 * true for a crash, because the reload is decided by the same check.
 */
export function optionalLoadFailure(
  part: OptionalPart,
  error: unknown,
  reloading = false,
  componentStack?: string | null,
): ReportInput {
  const source = `optional:${part}`
  const cause = error instanceof Error ? error.name : typeof error
  if (!isLoadFailure(error)) {
    return {
      source,
      message: `Optional part crashed: ${part}: ${errorText(error)}`,
      level: part === 'qr' ? 'warn' : 'error',
      context: {
        cause,
        stack: error instanceof Error ? stackFrames(error.stack) : undefined,
        componentStack: componentStack?.trim().slice(0, COMPONENT_STACK_MAX) || undefined,
      },
    }
  }
  const detail = errorText(error).slice(0, DETAIL_MAX)
  return {
    source,
    // One stable sentence per part, so every occurrence groups into one row in /admin.
    message: `Optional part could not load: ${part}`,
    // A missing QR code costs the guest a picture beside a link they can still copy, and a reload
    // that heals a stale deploy costs them a moment. A panel that stays missing costs them the thing
    // they came to do.
    level: reloading || part === 'qr' ? 'warn' : 'error',
    context: reloading ? { cause, detail, autoReloaded: true } : { cause, detail },
  }
}

/**
 * Should this failure spend the page's one stale-deploy reload, instead of being contained?
 *
 * The reload is the right answer to a REAL stale deploy: a tab opened before a deploy asks for chunk
 * names that no longer exist, and one reload fetches the new ones. Containing every chunk failure
 * would take that self-heal away from every guest with an old tab open. But it is the wrong answer
 * when the chunk exists and the device still will not fetch it -- the reload happens, the failure
 * repeats, and before this the second failure blanked the album. So: reload while the page's one
 * reload is still available and the error is a load failure; once it is spent, contain. A crash
 * never reloads: a reload fixes a stale deploy, not a bug.
 *
 * Never for the QR code. A picture beside a link the guest can still copy is not worth their page,
 * stale deploy or not.
 */
export function shouldReloadForOptional(part: OptionalPart, error: unknown, reloadAvailable: boolean): boolean {
  if (part === 'qr') return false
  if (!reloadAvailable) return false
  return isLoadFailure(error)
}

/**
 * Carry both decisions out: report the failure, and spend the page's one reload when it should be
 * spent. Returns whether the page is reloading, so a caller knows whether anything it shows next
 * will be seen. OptionalPanel calls it from its error boundary; a handler that catches its own
 * failure -- the share menu's table-card download -- calls it from a catch.
 */
export function failOptionalPart(part: OptionalPart, error: unknown, componentStack?: string | null): boolean {
  const reloading = shouldReloadForOptional(part, error, staleReloadStillAvailable())
  reportClientError(optionalLoadFailure(part, error, reloading, componentStack))
  if (reloading) reloadOnceForStaleDeploy()
  return reloading
}
