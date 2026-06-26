type AuthUserLike = { email?: string | null } | null | undefined

// Parsed once at module load — avoids per-request allocation and guarantees
// consistent behaviour regardless of how many times isAccountAdmin is called.
let _adminEmails: Set<string> | null = null

function adminEmails(): Set<string> {
  if (_adminEmails !== null) return _adminEmails
  const raw = process.env.ADMIN_EMAILS ?? ''
  if (!raw.trim()) {
    _adminEmails = new Set<string>()
    return _adminEmails
  }
  _adminEmails = new Set<string>(
    raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  )
  return _adminEmails
}

export function isAccountAdmin(user: AuthUserLike): boolean {
  const emails = adminEmails()
  if (emails.size === 0) return false
  const email = user?.email?.toLowerCase()
  if (!email) return false
  return emails.has(email)
}
