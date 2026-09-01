'use client'

import { useState } from 'react'
import type { Album } from '@/types'
import { RENEWAL_CATALOGUE } from '@/lib/package-catalogue'
import { formatPrice } from '@/lib/plan-catalogue'
import { showAppToast } from '@/components/AppToast'
import { useT } from '@/i18n/LocaleProvider'
import { startPackageCheckoutRequest } from '@/components/owner-toolbar/api'

// THE RENEWAL EMAIL'S LANDING SPOT — and it must work with nothing but the email.
//
// The link is /album?renew=1, opened two years after the event on whatever device the owner reads
// mail with. No owner cookie survives that long, and the #owner= token is deliberately not in the
// email (an emailed management link is a management link in every forwarded copy). The owner
// toolbar therefore does NOT render — which for a while made the renewal email a dead end: it
// pointed at a button inside a component its recipient could never see.
//
// So this card renders for ANYONE arriving with ?renew=1 on a packaged album, and the SERVER
// decides: checkout accepts the owner cookie or the signed-in owning account. A stranger who taps
// renew gets the server's refusal; a signed-out owner gets the login round-trip and comes back.
// Worst case for a non-owner is seeing that the album has a package — which the payload already
// says.
type Props = { album: Album }

export default function RenewPackagePrompt({ album }: Props) {
  const { t } = useT()
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const tier = album.package_tier
  const expiresAt = album.package_expires_at
  if (dismissed || !tier || !expiresAt) return null

  const isMax = tier === 'studio'
  const renewal = RENEWAL_CATALOGUE[isMax ? 'renewal_max' : 'renewal_pro']
  const slug = album.custom_slug ?? album.slug

  async function renew() {
    if (busy) return
    setBusy(true)
    try {
      const result = await startPackageCheckoutRequest(slug, isMax ? 'renewal_max' : 'renewal_pro')
      if (result.ok) {
        window.location.href = result.url
        return
      }
      if (result.signInRequired) {
        window.location.href = `/login?next=${encodeURIComponent(`/${slug}?renew=1`)}`
        return
      }
      showAppToast(result.error, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hush-container" style={{ marginBottom: 12 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '12px 16px', borderRadius: 12,
          background: 'rgba(99, 8, 38, 0.06)', border: '1px solid rgba(99, 8, 38, 0.16)',
        }}
      >
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#7C4A2D', margin: 0 }}>
            {isMax ? t('ot.packageMaxName') : t('ot.packageProName')}
          </p>
          <p style={{ fontSize: 12, color: '#8A7563', margin: '2px 0 0' }}>
            {t('ot.packageUntil')}{' '}
            {new Date(expiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void renew()}
          disabled={busy}
          style={{
            flex: '0 0 auto', padding: '8px 16px', borderRadius: 999, border: 'none',
            background: busy ? '#B0A090' : '#7C4A2D', color: '#FDFAF5',
            fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {t('ot.packageRenew')} {formatPrice(renewal.amountCents)}/{t('ot.packageYear')}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          style={{ flex: '0 0 auto', border: 'none', background: 'none', color: '#B0A090', fontSize: 16, cursor: 'pointer' }}
        >
          ×
        </button>
      </div>
    </div>
  )
}
