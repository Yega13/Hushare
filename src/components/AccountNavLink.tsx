'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { CircleUserRound } from 'lucide-react'
import { useAccountIdentity, clearAccountIdentityCache } from '@/lib/use-account-identity'
import { watchAuthFromOtherTabs } from '@/lib/auth-tab-sync'
import { useT } from '@/i18n/LocaleProvider'

const linkClass = 'text-sm font-medium hover:underline'
const linkStyle = { color: '#630826' } as const

export default function AccountNavLink() {
  const { t } = useT()
  // ONE request, both answers, one state transition. See lib/use-account-identity for the flicker
  // this replaced: sign-in state and picture were fetched separately and in sequence, so the slot
  // rendered three different shapes on the way to settling.
  const { status, avatarUrl } = useAccountIdentity()

  // A sign-in or sign-out in ANOTHER tab clears the cache, which re-asks every control showing an
  // identity so they settle together in one step -- no reload, nothing interrupted. Only real changes
  // of identity count: TOKEN_REFRESHED fires roughly hourly, and an earlier draft that reacted to it
  // reloaded the page, which would have restarted someone's upload once an hour.
  //
  // Heard on supabase-js's own cross-tab channel, NOT through a Supabase client: creating one here put
  // the whole library (221 KB) on every marketing page for this one listener (lib/auth-tab-sync).
  useEffect(() => watchAuthFromOtherTabs(clearAccountIdentityCache), [])

  const state = status

  if (state === 'loading') {
    // Sized for the MAJORITY outcome. Most visitors on the pages that render this are signed out
    // and resolve to the "Sign in" text — so the placeholder is that text, invisible, exactly as
    // wide as what will replace it: zero shift for most people. The minimums keep at least the
    // avatar circle's box, so a signed-in resolve shrinks gracefully instead of jumping height.
    // (A fixed 1.9rem square here optimised for the signed-in case and moved the shift onto
    // everyone else — the wrong trade, caught in review.)
    return (
      <span
        className={linkClass}
        aria-hidden="true"
        style={{ display: 'inline-block', minWidth: '1.9rem', minHeight: '1.9rem', color: 'transparent' }}
      >
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
