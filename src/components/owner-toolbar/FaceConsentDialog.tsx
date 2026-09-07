'use client'

import { useState } from 'react'
import { showAppToast } from '@/components/AppToast'
import { useT } from '@/i18n/LocaleProvider'

// ARTICLE 9 CONSENT GATE. The privacy policy and the terms both stated the owner confirms they hold
// explicit consent, and until now the product never asked, so the confirmation those documents
// relied on did not exist. This is that confirmation, at the only moment it means anything: before
// a single face template is computed. Switching face search ON is the one control that creates
// biometric data, so it is the one control that asks first; turning it OFF stays a single tap --
// nobody should have to read a dialog to stop processing.

type Props = {
  onCancel: () => void
  onConfirm: () => void
}

export default function FaceConsentDialog({ onCancel, onConfirm }: Props) {
  const { t } = useT()
  const [consentCopied, setConsentCopied] = useState(false)
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="face-consent-title"
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(30,18,12,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', borderRadius: 18, maxWidth: 520, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 22, boxShadow: '0 18px 50px rgba(40,20,10,0.28)' }}
      >
        <h3 id="face-consent-title" className="text-lg font-semibold" style={{ color: '#630826' }}>
          {t('ot.faceConsent.title')}
        </h3>
        <p className="mt-3 text-sm" style={{ color: '#5C4632', lineHeight: 1.6 }}>{t('ot.faceConsent.b1')}</p>
        <p className="mt-3 text-sm" style={{ color: '#5C4632', lineHeight: 1.6 }}>{t('ot.faceConsent.b2')}</p>
        <blockquote className="mt-3 text-sm italic" style={{ color: '#4A3626', background: '#F6F1E8', border: '1px solid #E8E0D0', borderRadius: 12, padding: '12px 14px', margin: 0, lineHeight: 1.6 }}>
          {t('ot.faceConsent.wording')}
        </blockquote>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(t('ot.faceConsent.wording'))
              setConsentCopied(true)
            } catch { showAppToast(t('common.networkError'), 'error') }
          }}
          className="mt-2 text-xs font-semibold"
          style={{ color: '#630826', background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', textDecoration: 'underline' }}
        >
          {consentCopied ? t('ot.faceConsent.copied') : t('ot.faceConsent.copy')}
        </button>
        <p className="mt-3 text-sm" style={{ color: '#5C4632', lineHeight: 1.6 }}>{t('ot.faceConsent.b3')}</p>
        <p className="mt-3 text-sm font-semibold" style={{ color: '#7A2A1F', lineHeight: 1.6 }}>{t('ot.faceConsent.b4')}</p>
        <a href="/privacy#face-search" target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs" style={{ color: '#630826' }}>
          {t('ot.faceConsent.learn')}
        </a>
        <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="text-sm font-semibold rounded-xl px-4 py-2.5"
            style={{ color: '#5C4632', background: '#F1EADD', border: '1px solid #DDD5C5', cursor: 'pointer' }}
          >
            {t('ot.faceConsent.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="text-sm font-semibold rounded-xl px-4 py-2.5"
            style={{ color: '#FDFAF5', background: '#630826', border: '1px solid #630826', cursor: 'pointer' }}
          >
            {t('ot.faceConsent.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
