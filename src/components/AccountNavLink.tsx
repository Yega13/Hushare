'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CircleUserRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type AuthState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; canAccess: boolean }

const linkClass = 'text-sm font-medium hover:underline'
const linkStyle = { color: '#254F22' } as const

export default function AccountNavLink() {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [state, setState] = useState<AuthState>({ kind: 'loading' })
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      // getUser() validates the JWT server-side; getSession() only reads the local cache
      // and can be stale or tampered with.
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      if (!user) {
        setState({ kind: 'signed-out' })
        return
      }
      try {
        const res = await fetch('/api/me', { cache: 'no-store' })
        if (cancelled) return
        if (res.ok) {
          const me = await res.json() as { canAccessAccount: boolean }
          setState({ kind: 'signed-in', canAccess: me.canAccessAccount })
        } else {
          setState({ kind: 'signed-in', canAccess: false })
        }
      } catch {
        if (!cancelled) setState({ kind: 'signed-in', canAccess: false })
      }
    }

    refresh()
    // Skip INITIAL_SESSION — it fires on every mount and would trigger a second concurrent
    // refresh() call on top of the explicit one above, wasting a getUser() round-trip.
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'INITIAL_SESSION') return
      void refresh()
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [supabase])

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await supabase.auth.signOut()
      router.push('/')
      router.refresh()
    } finally {
      setSigningOut(false)
    }
  }

  if (state.kind === 'loading') {
    return (
      <span className={linkClass} aria-hidden="true" style={{ color: 'transparent' }}>
        Sign in
      </span>
    )
  }

  if (state.kind === 'signed-out') {
    return (
      <Link href="/login" className={linkClass} style={linkStyle}>
        Sign in
      </Link>
    )
  }

  if (state.canAccess) {
    return (
      <Link href="/account" className={`${linkClass} hush-account-nav-link`} style={linkStyle} aria-label="Account">
        <span className="hush-account-label-full">Account</span>
        <CircleUserRound className="hush-account-icon" aria-hidden="true" />
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={signingOut}
      className={`${linkClass} disabled:opacity-50`}
      style={linkStyle}
    >
      {signingOut ? 'Signing out...' : 'Sign out'}
    </button>
  )
}
