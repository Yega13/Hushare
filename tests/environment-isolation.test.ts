import { describe, it, expect } from 'vitest'
import { environmentMisconfiguration } from '@/lib/server/environment'

// STAGING POINTED AT PRODUCTION IS THE MOST DANGEROUS OBJECT IN THE SYSTEM.
//
// It exists so things can be broken on purpose — dropped tables, mass deletions, replayed
// migrations. Wired to production it does all of that to real albums, and it does not announce
// itself first: a staging deploy that kept production's NEXT_PUBLIC_SUPABASE_URL does not error,
// it works perfectly, until the first destructive test.
//
// So the wiring is asserted rather than trusted, and asserted HERE rather than only in the running
// worker, because the worker only finds out at the moment it is already connected.
const STAGING_OK = {
  HUSHARE_ENV: 'staging',
  NEXT_PUBLIC_SUPABASE_URL: 'https://stagingprojectref.supabase.co',
  R2_BUCKET_NAME: 'hushare-media-staging',
  R2_PUBLIC_HOST: 'media-staging.hushare.space',
  NEXT_PUBLIC_SITE_URL: 'https://staging.hushare.space',
}

describe('a staging build cannot reach production', () => {
  it('accepts a correctly wired staging environment', () => {
    expect(environmentMisconfiguration(STAGING_OK)).toBeNull()
  })

  // Each of these is a single forgotten override, which is exactly how it happens in practice.
  const leaks: [string, Record<string, string | undefined>, string][] = [
    ['the production database', { NEXT_PUBLIC_SUPABASE_URL: 'https://yqngmyjquwemwogdyuwv.supabase.co' }, 'PRODUCTION database'],
    ['the production bucket', { R2_BUCKET_NAME: 'hushare-media' }, 'PRODUCTION bucket'],
    ['the production media host', { R2_PUBLIC_HOST: 'videos.hushare.space' }, 'PRODUCTION media host'],
    ['the production site url', { NEXT_PUBLIC_SITE_URL: 'https://hushare.space' }, 'PRODUCTION site'],
    ['no database at all', { NEXT_PUBLIC_SUPABASE_URL: '' }, 'not set at all'],
  ]
  for (const [name, override, expected] of leaks) {
    it(`refuses when staging still points at ${name}`, () => {
      const problem = environmentMisconfiguration({ ...STAGING_OK, ...override })
      expect(problem, `staging with ${name} must be refused`).not.toBeNull()
      expect(problem).toContain(expected)
    })
  }

  it('names every leak at once, not just the first', () => {
    // Fixing one and redeploying to discover the next is how a careful person ends up with a
    // half-wired staging environment they believe is isolated.
    const problem = environmentMisconfiguration({
      HUSHARE_ENV: 'staging',
      NEXT_PUBLIC_SUPABASE_URL: 'https://yqngmyjquwemwogdyuwv.supabase.co',
      R2_BUCKET_NAME: 'hushare-media',
      R2_PUBLIC_HOST: 'videos.hushare.space',
      NEXT_PUBLIC_SITE_URL: 'https://hushare.space',
    })
    for (const phrase of ['PRODUCTION database', 'PRODUCTION bucket', 'PRODUCTION media host', 'PRODUCTION site']) {
      expect(problem).toContain(phrase)
    }
  })

  it('never blocks production itself', () => {
    // The guard runs inside createAdminClient, on every privileged database call in the app. If it
    // could ever fire in production it would take the whole site down, which is a far worse
    // outcome than the one it prevents.
    expect(environmentMisconfiguration({
      NEXT_PUBLIC_SUPABASE_URL: 'https://yqngmyjquwemwogdyuwv.supabase.co',
      R2_BUCKET_NAME: 'hushare-media',
      R2_PUBLIC_HOST: 'videos.hushare.space',
      NEXT_PUBLIC_SITE_URL: 'https://hushare.space',
    })).toBeNull()
    expect(environmentMisconfiguration({ HUSHARE_ENV: 'production' })).toBeNull()
    // Not even with nothing set at all — an unconfigured production build fails loudly on its own
    // missing credentials, and that is a clearer error than this one.
    expect(environmentMisconfiguration({})).toBeNull()
  })
})
