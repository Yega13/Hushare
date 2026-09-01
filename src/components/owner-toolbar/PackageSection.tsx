'use client'

import { useState } from 'react'
import { ChevronDown, Gem } from 'lucide-react'
import type { Album } from '@/types'
import { PACKAGE_CATALOGUE, RENEWAL_CATALOGUE } from '@/lib/package-catalogue'
import { formatPrice } from '@/lib/plan-catalogue'
import { showAppToast } from '@/components/AppToast'
import { startPackageCheckoutRequest } from '@/components/owner-toolbar/api'
import { accordionButton, sectionTitle, settingsSectionStyle } from '@/components/owner-toolbar/styles'

// THE ALBUM'S PACKAGE — status and renewal when one is live, the two offers when none is.
//
// Lives outside OwnerToolbar because the toolbar is the largest component in the app and the
// architecture ratchet is the thing that keeps it from growing forever; the decisions here
// (prices, what a package includes, whether one is live) all come from lib either way.
//
// The renewal email lands on /album?renew=1 and the toolbar opens straight onto this section, so
// the person who clicked "Renew" in an email is one tap from paying.

type Props = {
  album: Album
  packagedLive: boolean
  open: boolean
  onToggle: () => void
  t: (key: string, params?: Record<string, string | number>) => string
}

export default function PackageSection({ album, packagedLive, open, onToggle, t }: Props) {
  const [busy, setBusy] = useState(false)

  async function startCheckout(item: 'package_pro' | 'package_max' | 'renewal_pro' | 'renewal_max') {
    if (busy) return
    setBusy(true)
    try {
      const result = await startPackageCheckoutRequest(album.slug, item)
      if (result.ok) {
        window.location.href = result.url
        return
      }
      if (result.signInRequired) {
        // The server insists on an account (the owner's rule: a paid album must never be findable
        // only through one browser's link). Round-trip through login and come back here.
        window.location.href = `/login?next=${encodeURIComponent(`/${album.custom_slug ?? album.slug}?renew=1`)}`
        return
      }
      showAppToast(result.error, 'error')
    } finally {
      setBusy(false)
    }
  }

  const isMax = album.package_tier === 'studio'

  return (
    <section style={settingsSectionStyle}>
      <button type="button" className="hush-motion" style={accordionButton} onClick={onToggle}>
        <Gem className="w-4 h-4" style={{ color: '#7C5C3E' }} />
        <span style={sectionTitle}>{t('ot.package')}</span>
        {packagedLive && (
          <span className="text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5" style={{ background: '#2E6B4F', color: '#FDFAF5' }}>
            {isMax ? 'Max' : 'Pro'}
          </span>
        )}
        <ChevronDown
          className="ml-auto w-4 h-4 transition-transform"
          style={{ color: '#A89880', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {packagedLive ? (
            <div className="rounded-xl px-3 py-3" style={{ background: '#FDFAF5', border: '1px solid #DDD5C5' }}>
              <p className="text-sm font-semibold" style={{ color: '#630826' }}>
                {isMax ? t('ot.packageMaxName') : t('ot.packageProName')}
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#7C5C3E' }}>
                {t('ot.packageUntil')}{' '}
                {new Date(album.package_expires_at as string).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void startCheckout(isMax ? 'renewal_max' : 'renewal_pro')}
                className="hush-press mt-3 rounded-lg px-4 py-2 text-xs font-bold"
                style={{ background: '#630826', color: '#FDFAF5', cursor: busy ? 'wait' : 'pointer' }}
              >
                {t('ot.packageRenew')}{' '}
                {formatPrice(RENEWAL_CATALOGUE[isMax ? 'renewal_max' : 'renewal_pro'].amountCents)}/{t('ot.packageYear')}
              </button>
            </div>
          ) : (
            <>
              <p className="text-xs" style={{ color: '#7C5C3E' }}>{t('ot.packageSub')}</p>
              {(['package_pro', 'package_max'] as const).map((key) => (
                <div key={key} className="rounded-xl px-3 py-3" style={{ background: '#FDFAF5', border: '1px solid #DDD5C5' }}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: '#630826' }}>
                        {key === 'package_max' ? t('ot.packageMaxName') : t('ot.packageProName')}
                        {' · '}{formatPrice(PACKAGE_CATALOGUE[key].amountCents)}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: '#7C5C3E' }}>
                        {key === 'package_max'
                          ? t('ot.packageMaxLine', { items: PACKAGE_CATALOGUE.package_max.items.toLocaleString('en-US'), years: PACKAGE_CATALOGUE.package_max.years })
                          : t('ot.packageProLine', { items: PACKAGE_CATALOGUE.package_pro.items.toLocaleString('en-US'), years: PACKAGE_CATALOGUE.package_pro.years })}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void startCheckout(key)}
                      className="hush-press rounded-lg px-4 py-2 text-xs font-bold shrink-0"
                      style={{ background: '#630826', color: '#FDFAF5', cursor: busy ? 'wait' : 'pointer' }}
                    >
                      {t('ot.packageGet')}
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  )
}
