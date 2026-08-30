'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CircleUserRound } from 'lucide-react'
import { useAccountIdentity, clearAccountIdentityCache } from '@/lib/use-account-identity'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/LocaleProvider'

const linkClass = 'text-sm font-medium hover:underline'
const linkStyle = { color: '#630826' } as const

export default function AccountNavLink() {
  const { t } = useT()
  const [supabase] = useState(() => createClient())
  // ONE request, both answers, one state transition. See lib/use-account-identity for the flicker
  // this replaced: sign-in state and picture were fetched separately and in sequence, so the slot
  // rendered three different shapes on the way to settling.
  const { status, avatarUrl } = useAccountIdentity()

  useEffect(() => {
    // ONLY a real change of identity. TOKEN_REFRESHED fires roughly hourly on its own, and
    // INITIAL_SESSION fires on every mount — reacting to either would re-ask on a schedule for an
    // answer that has not changed, and an earlier draft of this reloaded the page on them, which
    // would have restarted someone's upload once an hour.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT' && event !== 'USER_UPDATED') return
      // Clearing notifies every control showing an identity, so they re-ask together and settle in
      // one step — no reload, nothing interrupted.
      clearAccountIdentityCache()
    })
    return () => { sub.subscription.unsubscribe() }
  }, [supabase])

  const state = status

  if (state === 'loading') {
    // Holds the space the resolved control will take, rather than the width of the word "Sign in".
    // The old placeholder was text-width while the settled control is a 1.9rem circle, so every
    // signed-in page load shifted the nav sideways as it resolved.
    return (
      <span
        className={linkClass}
        aria-hidden="true"
        style={{ display: 'inline-block', width: '1.9rem', height: '1.9rem', color: 'transparent' }}
      />
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
    // With a picture, the picture IS the label — the word beside it says nothing the face does not.
    // Without one, the word stays: an unexplained generic icon is worse than a plain link.
    <Link
      href="/account"
      className={`${linkClass} hush-account-nav-link${avatarUrl ? ' hush-account-has-avatar' : ''}`}
      style={linkStyle}
      aria-label={t('nav.account')}
    >
      <span className="hush-account-label-full">{t('nav.account')}</span>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="hush-account-avatar"
          style={{ borderRadius: '50%', objectFit: 'cover' }}
          aria-hidden="true"
        />
      ) : (
        <CircleUserRound className="hush-account-icon" aria-hidden="true" />
      )}
    </Link>
  )
}
