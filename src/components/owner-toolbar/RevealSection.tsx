'use client'

import { useState } from 'react'
import { ChevronDown, Clock } from 'lucide-react'
import type { Album, Tier } from '@/types'
import { toDatetimeLocal, revealRequestFor, revealStatus } from '@/lib/reveal-input'
import { FEATURE_TIER } from '@/lib/plan-gates'
import { showAppToast } from '@/components/AppToast'
import { saveRevealRequest } from '@/components/owner-toolbar/api'
import { accordionButton, sectionTitle, settingsSectionStyle } from '@/components/owner-toolbar/styles'
import PlanBadge from '@/components/PlanBadge'
import RevealDatePicker from '@/components/RevealDatePicker'
import { useT } from '@/i18n/LocaleProvider'

// THE DELAYED-REVEAL PANEL: the album stays sealed until a date. Owns its own four pieces of state;
// the rules it applies (what the picker shows, what a save sends, whether the album is still sealed)
// are lib/reveal-input, where they are tested.

type Props = {
  album: Album
  userTier: Tier | null
  open: boolean
  onToggle: () => void
  onAlbumUpdated: (patch: Partial<Album>) => void
}

export default function RevealSection({ album, userTier, open, onToggle, onAlbumUpdated }: Props) {
  const { t } = useT()
  const [revealInput, setRevealInput] = useState(() => toDatetimeLocal(album.reveal_at ?? null))
  const [revealSaving, setRevealSaving] = useState(false)
  const [revealError, setRevealError] = useState('')
  const [revealSaved, setRevealSaved] = useState(false)

  // One `now` per render, so the header badge and the panel body agree about "future".
  const status = revealStatus(album.reveal_at, new Date())
  const revealIsFuture = status === 'future'

  async function saveReveal(action: 'set' | 'clear') {
    setRevealError('')
    setRevealSaved(false)
    // Validated BEFORE "saving" flips on, so an invalid date cannot leave the button on "Saving…".
    const request = revealRequestFor(action, revealInput)
    if (!request.ok) {
      setRevealError('Invalid date')
      return
    }
    setRevealSaving(true)
    try {
      const result = await saveRevealRequest(album.slug, request.revealAt)
      if (!result.ok) {
        const message = result.error || t('ot.revealSaveFail')
        setRevealError(message)
        showAppToast(message, 'error')
        return
      }
      onAlbumUpdated({ reveal_at: result.reveal_at })
      setRevealInput(toDatetimeLocal(result.reveal_at))
      setRevealSaved(true)
      showAppToast(action === 'clear' ? t('ot.revealCleared') : t('ot.revealSaved'))
    } catch (e) {
      const message = e instanceof Error ? e.message : t('common.networkError')
      setRevealError(message)
      showAppToast(message, 'error')
    } finally {
      setRevealSaving(false)
    }
  }

  return (
    <section style={settingsSectionStyle}>
      <button type="button" className="hush-motion" style={accordionButton} onClick={onToggle}>
        <Clock className="w-4 h-4" style={{ color: revealIsFuture ? '#630826' : '#7C5C3E' }} />
        <span style={sectionTitle}>{t('ot.delayedReveal')}</span>
        <PlanBadge need={FEATURE_TIER.countdownReveal} tier={userTier} />
        {revealIsFuture && (
          <span
            className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
            style={{ background: 'rgba(99,8,38,0.10)', color: '#630826' }}
          >
            {t('ot.active')}
          </span>
        )}
        <ChevronDown
          className="ml-auto w-4 h-4 transition-transform"
          style={{ color: '#A89880', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {album.reveal_at && status !== 'none' && (
            <div
              className="flex items-start gap-2.5 rounded-xl px-3 py-2.5"
              style={{
                background: revealIsFuture ? 'rgba(99,8,38,0.07)' : 'rgba(139,111,78,0.09)',
                border: `1px solid ${revealIsFuture ? 'rgba(99,8,38,0.18)' : 'rgba(139,111,78,0.22)'}`,
              }}
            >
              <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: revealIsFuture ? '#630826' : '#8B6F4E' }} />
              <div>
                <p className="text-[11px] font-semibold leading-none mb-1" style={{ color: revealIsFuture ? '#630826' : '#8B6F4E' }}>
                  {revealIsFuture ? t('ot.unlocksOn') : t('ot.alreadyRevealed')}
                </p>
                <p className="text-xs" style={{ color: '#5C4A3C' }}>
                  {new Date(album.reveal_at).toLocaleString([], {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          )}

          <div>
            <p className="text-[11px] font-medium mb-1.5" style={{ color: '#8B6F4E' }}>
              {album.reveal_at ? t('ot.changeTime') : t('ot.unlockAt')}
            </p>
            <RevealDatePicker
              value={revealInput}
              onChange={(v) => { setRevealInput(v); setRevealSaved(false) }}
            />
          </div>

          {revealError && <p className="text-xs" style={{ color: '#C0392B' }}>{revealError}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={() => void saveReveal('set')}
              disabled={revealSaving || !revealInput}
              className="hush-press flex-1 text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#630826', color: '#FDFAF5' }}
            >
              {revealSaving ? t('ot.saving') : revealSaved ? `✓ ${t('ot.saved')}` : t('ot.save')}
            </button>
            {album.reveal_at && (
              <button
                onClick={() => void saveReveal('clear')}
                disabled={revealSaving}
                className="hush-press text-sm rounded-lg py-2 px-3 transition hover:opacity-80 disabled:opacity-50"
                style={{ background: 'transparent', color: '#8B6F4E', border: '1px solid #DDD5C5' }}
              >
                {t('ot.remove')}
              </button>
            )}
          </div>

          {!album.reveal_at && (
            <p className="text-[11px] leading-relaxed" style={{ color: '#A89880' }}>
              {t('ot.revealNote')}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
