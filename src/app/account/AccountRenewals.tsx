'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { RenewalNotice } from '@/lib/package-renewal'
import { RENEWAL_CATALOGUE } from '@/lib/package-catalogue'
import { formatPrice } from '@/lib/plan-catalogue'
import { startPackageCheckoutRequest } from '@/components/owner-toolbar/api'

// THE RENEWAL SURFACE THAT CANNOT BE GATED.
//
// The renewal email points here rather than at the album. An album can sit behind a password or a
// reveal date, and the owner opening that email two years later has neither the password in mind
// nor an owner cookie on that device — so the album was a dead end for the one person who needed
// to pay. This page requires only that they are signed in, which the checkout requires anyway.
//
// Everything shown is already theirs: these rows come from albums where user_id = the session.
type Props = { notices: RenewalNotice[]; highlightSlug: string | null }

export default function AccountRenewals({ notices, highlightSlug }: Props) {
  const [busySlug, setBusySlug] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  if (notices.length === 0) return null

  async function renew(slug: string, tier: 'pro' | 'studio') {
    if (busySlug) return
    setBusySlug(slug)
    setFailed(null)
    const result = await startPackageCheckoutRequest(slug, tier === 'studio' ? 'renewal_max' : 'renewal_pro')
    if (result.ok) {
      window.location.href = result.url
      return
    }
    // Signed out mid-page (an expired session): back through login, returning here.
    if (result.signInRequired) {
      window.location.href = `/login?next=${encodeURIComponent(`/account?renew=${slug}`)}`
      return
    }
    setFailed(result.error)
    setBusySlug(null)
  }

  return (
    <section className="mb-8">
      <div className="rounded-2xl p-5" style={{ background: '#FFF6EC', border: '1px solid #E8C9A0' }}>
        <h2 className="text-base font-semibold mb-1" style={{ color: '#7C4A2D' }}>
          {notices.length === 1 ? 'An album needs renewing' : 'Albums that need renewing'}
        </h2>
        <p className="text-xs mb-4" style={{ color: '#8B6F4E' }}>
          One payment adds another year. Nothing renews by itself and no card is kept on file.
        </p>

        <ul className="flex flex-col gap-3">
          {notices.map(({ album, tier, daysLeft, lapsed }) => {
            const slug = album.custom_slug ?? album.slug
            const renewal = RENEWAL_CATALOGUE[tier === 'studio' ? 'renewal_max' : 'renewal_pro']
            const highlighted = highlightSlug === slug || highlightSlug === album.slug
            return (
              <li
                key={album.id}
                className="flex items-center gap-3 flex-wrap rounded-xl p-3"
                style={{
                  background: '#FFFFFF',
                  border: highlighted ? '1px solid #C98A4B' : '1px solid #EFE3D2',
                }}
              >
                <div className="flex-1 min-w-0" style={{ flexBasis: '220px' }}>
                  <Link href={`/${slug}`} className="text-sm font-semibold truncate block hover:underline" style={{ color: '#630826' }}>
                    {album.title || slug}
                  </Link>
                  <p className="text-xs mt-0.5" style={{ color: lapsed ? '#A33' : '#8B6F4E' }}>
                    {lapsed
                      ? 'Expired — renew to keep it online'
                      : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left · ${tier === 'studio' ? 'Max' : 'Pro'} Package`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void renew(slug, tier)}
                  disabled={busySlug !== null}
                  className="rounded-full px-4 py-2 text-sm font-semibold"
                  style={{
                    background: busySlug === slug ? '#B0A090' : '#630826',
                    color: '#FDFAF5',
                    cursor: busySlug ? 'default' : 'pointer',
                    opacity: busySlug && busySlug !== slug ? 0.5 : 1,
                  }}
                >
                  {busySlug === slug ? 'Opening…' : `Renew ${formatPrice(renewal.amountCents)}/year`}
                </button>
              </li>
            )
          })}
        </ul>

        {failed && <p className="text-xs mt-3" style={{ color: '#A33' }}>{failed}</p>}
      </div>
    </section>
  )
}
