import { isAccountAdmin } from './auth'
import { getActiveSubscription } from './subscriptions'

export async function hasAccountAccess(
  user: { id?: string; email?: string | null } | null | undefined,
): Promise<boolean> {
  if (isAccountAdmin(user)) return true
  if (!user?.id) return false
  return (await getActiveSubscription(user.id)) !== null
}
