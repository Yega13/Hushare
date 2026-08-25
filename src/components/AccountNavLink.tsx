'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CircleUserRound } from 'lucide-react'
import { useAccountAvatar } from '@/lib/use-account-avatar'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/LocaleProvider'

type AuthState = 'loading' | 'signed-out' | 'signed-in'

const linkClass = 'text-sm font-medium hover:underline'
const linkStyle = { color: '#630826' } as const

export default function AccountNavLink() {
  const { t } = useT()
  const [supabase] = useState(() => createClient())
  const [state, setState] = useState<AuthState>('loading')

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      // Fast path: read the LOCAL session (no network) so the nav resolves immediately instead of
      // popping in after a round-trip. Security is unaffected — the account page validates server-side.
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      if (!session) { setState('signed-out'); return }
      setState('signed-in')
      // Confirm the session is still valid server-side; downgrade to signed-out if it's stale.
      try {
        const res = await fetch('/api/me', { cache: 'no-store' })
        if (!cancelled && res.status === 401) setState('signed-out')
      } catch { /* keep the optimistic signed-in state */ }
    }

    refresh()
    // Skip INITIAL_SESSION — it fires on every mount and would double the refresh() work.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'INITIAL_SESSION') return
      void refresh()
    })

    return () => { cancelled = true; sub.subscription.unsubscribe() }
  }, [supabase])

  // Asked for only once signed in, and shared with the compact mobile button so the two of them
  // make one request between them rather than one each.
  const avatarUrl = useAccountAvatar(state === 'signed-in')

  if (state === 'loading') {
    return (
      <span className={linkClass} aria-hidden="true" style={{ color: 'transparent' }}>
        {t('nav.signIn')}
      </span>
    )
  }

  if (state === 'signed-out') {
    return (
      <Link href="/login" className={linkClass} style={linkStyle}>
        {t('nav.signIn')}
      </Link>
    )
  }

  // Signed in — every account (free included) now has a dashboard, and sign-out lives there.
  return (
    <Link href="/account" className={`${linkClass} hush-account-nav-link`} style={linkStyle} aria-label={t('nav.account')}>
      <span className="hush-account-label-full">{t('nav.account')}</span>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="hush-account-icon"
          style={{ borderRadius: '50%', objectFit: 'cover' }}
          aria-hidden="true"
        />
      ) : (
        <CircleUserRound className="hush-account-icon" aria-hidden="true" />
      )}
    </Link>
  )
}
