// THE COLUMNS POSTGRES CONSTRAINS WITH A CHECK, AND TYPESCRIPT MIRRORS BY HAND.
//
// Thirteen columns in this database are `text` with a `CHECK (col = ANY (ARRAY[...]))`. That is an
// enum in everything but name — and because it is not a real pg enum, the generated Database type
// can only say `string`. So every one of them is a fact written down twice: once in the migration,
// once in a TypeScript union. Rule 13 says those two copies will disagree, and they already have:
// `photos.storage_backend`'s CHECK permits 'supabase', while StorageBackend has always been
// 'r2' | 'stream'.
//
// This module is the TypeScript side, in one place, and tests/schema-unions.test.ts reads the REAL
// constraints out of the live database and asserts they agree. That is rule 13's own prescribed
// remedy for a fact that genuinely cannot be imported: a test that reads the real source rather
// than a third copy of it.
//
// WHY NOT PUT THESE UNIONS IN Row. A CHECK constraint can be added `NOT VALID`, and rows that
// existed before it are then not covered by it. Declaring the union on the READ type would assert
// something about stored rows the database does not guarantee. The narrowing functions below are
// the honest shape: they take what the database can actually return and refuse what the code cannot
// handle (rule 19 — the uncertain branch does nothing).

/** albums.package_tier — a one-off package can entitle an album above its owner's account. */
export const PACKAGE_TIERS = ['pro', 'studio'] as const
export type PackageTier = (typeof PACKAGE_TIERS)[number]

/**
 * Narrow a package_tier column value.
 *
 * Returns null for anything unrecognised, and that direction is deliberate: an unknown tier means
 * "no package", so the album falls back to its owner's account entitlement. Guessing 'studio' from
 * a value we do not understand would hand out paid features for free; guessing nothing costs an
 * owner features they can ask about. Only reachable if the CHECK is widened without this being
 * updated, which is exactly what tests/schema-unions.test.ts fails on.
 */
export function asPackageTier(value: unknown): PackageTier | null {
  return typeof value === 'string' && (PACKAGE_TIERS as readonly string[]).includes(value)
    ? (value as PackageTier)
    : null
}

/** photos.media_type */
export const MEDIA_TYPES = ['image', 'video'] as const

/**
 * photos.storage_backend — DELIBERATELY NARROWER THAN THE DATABASE.
 *
 * The CHECK still permits 'supabase' from the era before media moved to R2. Zero rows carry it
 * (measured: 20,301 r2 + 192 stream + 0 supabase), and no code path can write it any more. The
 * union stays narrow because widening it would force every consumer to handle a case that cannot
 * occur; the constraint stays wide because dropping a CHECK value is a migration nobody needs.
 *
 * The disagreement is recorded here, and tests/schema-unions.test.ts allows exactly this one — so
 * the NEXT divergence fails rather than blending in with a known one.
 */
export const STORAGE_BACKENDS = ['r2', 'stream'] as const

/** Columns whose TypeScript union is deliberately a SUBSET of the database CHECK, with the reason. */
export const NARROWED_ON_PURPOSE: Record<string, { missing: readonly string[]; why: string }> = {
  'photos.storage_backend': {
    missing: ['supabase'],
    why: 'pre-R2 era; zero rows carry it and no code path can write it. Narrowing keeps consumers '
      + 'from handling a case that cannot occur.',
  },
}
