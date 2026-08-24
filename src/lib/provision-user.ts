import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

// Find an existing auth user by email, or create one (email pre-confirmed so they can sign in with
// a magic link and immediately land on their paid account). Returns the user id, or null on failure.
//
// Used to link a payment to an account when the checkout carried no in-app userId — e.g. a customer
// who bought through a direct Polar link and never created a Hushare account. Without this, such a
// payment is collected but has nothing to attach to, so it never appears in the app.
export async function findOrCreateUserByEmail(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null

  const admin = createAdminClient()

  // One indexed lookup against auth.users (see 20260824_find_user_by_email.sql).
  //
  // The pagination below is a HARD CEILING of 25 x 200 = 5,000 users, and passing it does not
  // degrade, it breaks: an existing customer is not found, createUser fails on the duplicate email,
  // this returns null, and the Polar webhook then answers 200 so Polar never retries -- a real
  // payment taken for nothing, invisibly. It is also 25 round trips on the checkout path.
  //
  // The scan is kept only as a fallback for the case where the function is missing (a database
  // restored from before this migration), so a deploy order mistake degrades instead of failing.
  {
    const { data, error } = await admin.rpc('find_user_id_by_email', { p_email: normalized })
    if (!error && typeof data === 'string' && data) return data
    if (error) console.error('[provision] find_user_id_by_email rpc failed, falling back to scan:', error.message)
  }

  // Fallback: paginated scan (listUsers is paginated; scan until found or exhausted).
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) {
      console.error('[provision] listUsers failed:', error.message)
      break
    }
    const found = data.users.find((u) => (u.email ?? '').toLowerCase() === normalized)
    if (found) return found.id
    if (data.users.length < 200) break // last page
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: normalized,
    email_confirm: true,
  })
  if (createErr || !created?.user) {
    console.error('[provision] createUser failed:', createErr?.message)
    return null
  }
  return created.user.id
}
