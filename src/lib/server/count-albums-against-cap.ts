import type { SupabaseClient } from '@supabase/supabase-js'

// HOW MANY OF SOMEONE'S ALBUMS COUNT AGAINST THEIR PLAN'S ALBUM CAP.
//
// Written once, because it was already written twice (album/create and the auto-claim in
// album-owner-access) and an adversarial review flagged a third copy forming. Two copies of "how
// we count someone's albums" is exactly the drift that turns a cap into two different caps.
//
// PACKAGED ALBUMS DO NOT COUNT. A package is paid for individually — $49/$99 for that one album —
// so it occupies no slot of the subscription's allowance. This is also load-bearing for the
// purchase flow: buying a package requires signing in, signing in claims the album, and if the
// claimed album counted against a free account's 3-album cap, the cap could refuse the very album
// somebody just paid for. The exclusion keys on package_tier alone (not expiry): a lapsed package
// album not counting is a small generosity, and re-counting an album years later because a $9
// renewal lapsed would mean an account silently going OVER cap with no action of its own.
//
// The error is returned, not swallowed: a count that failed is not a count of zero, and each
// caller decides its own safe direction (create refuses; auto-claim declines quietly).
export async function countAlbumsAgainstCap(
  admin: SupabaseClient,
  userId: string,
): Promise<{ count: number | null; error: { message: string } | null }> {
  const { count, error } = await admin
    .from('albums')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('retired_at', null)
    .is('package_tier', null)
  return { count, error }
}
