import { looksLikeStaleDeploy, type ReportInput } from '@/lib/report-error'

// WHAT TO DO WHEN AN OPTIONAL PART OF THE ALBUM PAGE WILL NOT LOAD -- and what never to say about it.
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

/** Every part of the album page that may fail to load without the album failing with it. */
export const OPTIONAL_PARTS = ['qr', 'upload', 'owner-toolbar', 'face-finder', 'designer'] as const
export type OptionalPart = (typeof OPTIONAL_PARTS)[number]

/** How much of the original error survives into the report. Enough to recognise, not enough to flood. */
export const DETAIL_MAX = 200

/**
 * The report for a part that would not load.
 *
 * The one rule that must hold: the message is never the error's own words. Those are chunk words,
 * and chunk words are what report-error answers with a reload. The original text is kept, in
 * context, where no reload rule reads it -- dropping it would erase the only evidence of a failure
 * nobody has explained yet.
 *
 * `reloading`: this failure is being answered with the page's one stale-deploy reload. That is the
 * cost of a deploy healing itself, filed at warn with autoReloaded -- the same weight report-error
 * gives a recovered stale deploy -- rather than as a guest who has lost a panel.
 */
export function optionalLoadFailure(part: OptionalPart, error: unknown, reloading = false): ReportInput {
  const cause = error instanceof Error ? error.name : typeof error
  const detail = (error instanceof Error ? error.message : String(error)).slice(0, DETAIL_MAX)
  return {
    source: `optional:${part}`,
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
 * reload is still available and the error looks like a stale deploy; once it is spent, contain.
 *
 * Never for the QR code. A picture beside a link the guest can still copy is not worth their page,
 * stale deploy or not.
 */
export function shouldReloadForOptional(part: OptionalPart, error: unknown, reloadAvailable: boolean): boolean {
  if (part === 'qr') return false
  if (!reloadAvailable) return false
  const message = error instanceof Error ? error.message : String(error)
  return looksLikeStaleDeploy(message)
}
