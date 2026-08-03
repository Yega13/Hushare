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

  // Look for an existing user (listUsers is paginated; scan until found or exhausted).
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
