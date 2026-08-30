// WHICH COPY OF HUSHARE IS THIS, AND IS IT WIRED TO ITS OWN THINGS?
//
// A staging environment exists so a change can be broken safely. It becomes the single most
// dangerous thing in the system the moment it is pointed at production's database or bucket,
// because staging is where destructive work is done deliberately: dropping tables, mass-deleting
// albums, replaying migrations. Every well-known "we lost production" story is this one.
//
// The wiring is a handful of environment variables, and the failure mode is the quiet one: forget
// to override NEXT_PUBLIC_SUPABASE_URL for staging and it does not error — it connects to
// production and works perfectly, right up until someone runs the thing they built staging for.
//
// So the coherence is asserted rather than assumed. If this build says it is staging, it must not
// be able to reach any production resource, and it refuses to serve rather than find out later.

/** The production resources, by their real identifiers. Staging must match none of them. */
const PRODUCTION = {
  supabaseRef: 'yqngmyjquwemwogdyuwv',
  r2Bucket: 'hushare-media',
  r2Host: 'videos.hushare.space',
  siteUrl: 'https://hushare.space',
} as const

export type HushareEnv = 'production' | 'staging'

export function currentEnv(): HushareEnv {
  return process.env.HUSHARE_ENV === 'staging' ? 'staging' : 'production'
}

/**
 * What, if anything, is wrong with this environment's wiring.
 *
 * Exported separately from the throwing version so it can be tested without a process that dies,
 * and so an admin page can show the answer rather than only crash on it.
 */
export function environmentMisconfiguration(
  // A plain record, not NodeJS.ProcessEnv: that type requires NODE_ENV, so a test could not hand
  // this the four variables it actually reads without inventing a fifth.
  env: Record<string, string | undefined> = process.env,
): string | null {
  const isStaging = env.HUSHARE_ENV === 'staging'
  if (!isStaging) return null

  const leaks: string[] = []
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (supabaseUrl.includes(PRODUCTION.supabaseRef)) {
    leaks.push('NEXT_PUBLIC_SUPABASE_URL points at the PRODUCTION database')
  }
  if ((env.R2_BUCKET_NAME ?? '') === PRODUCTION.r2Bucket) {
    leaks.push('R2_BUCKET_NAME is the PRODUCTION bucket')
  }
  if ((env.R2_PUBLIC_HOST ?? '').includes(PRODUCTION.r2Host)) {
    leaks.push('R2_PUBLIC_HOST is the PRODUCTION media host')
  }
  const site = (env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '')
  if (site === PRODUCTION.siteUrl) {
    leaks.push('NEXT_PUBLIC_SITE_URL is the PRODUCTION site')
  }
  // A staging build with no database of its own is not "partly configured", it is production with
  // a different name on it.
  if (!supabaseUrl) {
    leaks.push('NEXT_PUBLIC_SUPABASE_URL is not set at all')
  }

  if (leaks.length === 0) return null
  return (
    'STAGING IS WIRED TO PRODUCTION — refusing to run.\n' +
    leaks.map((l) => `  - ${l}`).join('\n') +
    '\nSet the staging values in wrangler.toml [env.staging] and as staging secrets. ' +
    'This check exists because the alternative is finding out during a destructive test.'
  )
}

/**
 * Call before doing anything privileged. Throws on a staging build that can reach production.
 *
 * Deliberately cheap and idempotent: it reads environment variables and nothing else, so it can sit
 * on the hot path of every admin database client without costing anything measurable.
 */
export function assertEnvironmentIsCoherent(): void {
  const problem = environmentMisconfiguration()
  if (problem) throw new Error(problem)
}
