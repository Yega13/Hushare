'use client'

import { useState } from 'react'
import { ChevronDown, Lock, LockOpen } from 'lucide-react'
import type { Album } from '@/types'
import { showAppToast } from '@/components/AppToast'
import { savePasswordRequest } from '@/components/owner-toolbar/api'
import { accordionButton, inputStyle, sectionTitle, settingsSectionStyle } from '@/components/owner-toolbar/styles'
import { useT } from '@/i18n/LocaleProvider'

// THE PASSWORD PANEL. No badge and no lock: password protection is free, and always has been --
// api/album/password has never carried a tier check. Charging for it in the UI while the server gave
// it away was the same contradiction the pricing page had.
//
// Owns its state. The parent keys this component on an epoch it bumps whenever the panel opens or
// Settings opens, so a partially-typed password is cleared at exactly those moments -- and kept when
// the owner merely closes and reopens the accordion, which the old inline version got right with
// a hand-maintained input key.

type Props = {
  album: Album
  /** The management URL, offered to the browser's password manager as the "username" of this entry. */
  ownerUrl: string | null
  open: boolean
  onToggle: () => void
  onAlbumUpdated: (patch: Partial<Album>) => void
}

export default function PasswordSection({ album, ownerUrl, open, onToggle, onAlbumUpdated }: Props) {
  const { t } = useT()
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function save(action: 'set' | 'clear') {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const result = await savePasswordRequest(album.slug, action === 'clear' ? null : input)
      if (!result.ok) {
        setError(result.error)
        showAppToast(result.error, 'error')
        return
      }
      onAlbumUpdated({ password_protected: result.password_protected })
      setSaved(true)
      setInput('')
    } catch (e) {
      const message = e instanceof Error ? e.message : t('common.networkError')
      setError(message)
      showAppToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section style={settingsSectionStyle}>
      <button type="button" className="hush-motion" style={accordionButton} onClick={onToggle}>
        {album.password_protected ? (
          <Lock className="w-4 h-4" style={{ color: '#630826' }} />
        ) : (
          <LockOpen className="w-4 h-4" style={{ color: '#7C5C3E' }} />
        )}
        <span style={sectionTitle}>{t('ot.password')}</span>
        <ChevronDown
          className="ml-auto w-4 h-4 transition-transform"
          style={{ color: '#A89880', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      {open && (
        <div className="px-4 pb-4">
          <p className="text-xs mb-3" style={{ color: '#7C5C3E' }}>
            {t('ot.passwordSub')}
          </p>
          <input type="text" name="username" autoComplete="username" value={ownerUrl ?? ''} readOnly hidden />
          <input
            type={input ? 'password' : 'text'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={album.password_protected ? t('ot.newPassword') : t('ot.passwordPlaceholder')}
            maxLength={128}
            autoComplete="new-password"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            name={`hush-album-password-${album.id}`}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            style={inputStyle}
            onKeyDown={(e) => { if (e.key === 'Enter' && !saving && input) void save('set') }}
          />
          {error && <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{error}</p>}
          {saved && !error && <p className="text-xs mt-2" style={{ color: '#630826' }}>{t('ot.saved')}</p>}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => void save('set')}
              disabled={saving || !input}
              className="hush-press flex-1 text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#630826', color: '#FDFAF5' }}
            >
              {saving ? t('ot.saving') : t('ot.save')}
            </button>
            {album.password_protected && (
              <button
                onClick={() => void save('clear')}
                disabled={saving}
                className="hush-press text-sm rounded-lg py-2 px-3 transition hover:opacity-90 disabled:opacity-50"
                style={{ background: '#F5F0E8', color: '#7C5C3E', border: '1px solid #DDD5C5' }}
              >
                {t('ot.remove')}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
