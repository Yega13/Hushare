'use client'

import { useState } from 'react'
import { ChevronDown, Link2 } from 'lucide-react'
import type { Album, Tier } from '@/types'
import { validateCustomSlug } from '@/lib/custom-slug'
import { FEATURE_TIER } from '@/lib/plan-gates'
import type { RowLook } from '@/lib/owner-rows'
import { showAppToast } from '@/components/AppToast'
import { saveCustomUrlRequest } from '@/components/owner-toolbar/api'
import { accordionButton, sectionTitle, settingsSectionStyle } from '@/components/owner-toolbar/styles'
import PlanBadge, { gatedRowStyle } from '@/components/PlanBadge'
import { useT } from '@/i18n/LocaleProvider'

// THE CUSTOM URL PANEL: hushare.space/anna-and-david instead of a random slug. Owns its state; the
// slug rules are lib/custom-slug, the SAME function the route validates with, run here first so the
// owner reads the reason at once instead of after a round trip (rule 13: one rule, two callers).

type Props = {
  album: Album
  userTier: Tier | null
  row: RowLook
  open: boolean
  onToggle: () => void
  onAlbumUpdated: (patch: Partial<Album>) => void
}

export default function CustomUrlSection({ album, userTier, row, open, onToggle, onAlbumUpdated }: Props) {
  const { t } = useT()
  const [input, setInput] = useState(album.custom_slug ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  // WHEN THE STORED VALUE CHANGES UNDER US -- another device saved, or our own save landed -- the
  // input follows it only if the owner has not typed anything: a draft is never wiped, and a save
  // keeps its "Saved" line. The first version keyed the whole component on album.custom_slug, which
  // remounted it on the owner's OWN save and discarded the confirmation in the same batch (and would
  // have wiped a half-typed draft on a change from another device). Reconciling during render is
  // the React-sanctioned shape for state that derives from a prop.
  const [seenSlug, setSeenSlug] = useState<string | null>(album.custom_slug ?? null)
  const storedSlug = album.custom_slug ?? null
  if (storedSlug !== seenSlug) {
    const pristine = input === (seenSlug ?? '')
    setSeenSlug(storedSlug)
    if (pristine) setInput(storedSlug ?? '')
  }

  async function save(action: 'set' | 'clear') {
    setError('')
    setSaved(false)
    let slug: string | null = null
    if (action === 'set') {
      const verdict = validateCustomSlug(input)
      if (!verdict.ok) { setError(verdict.reason); return }
      slug = verdict.slug
    }
    setSaving(true)
    try {
      const result = await saveCustomUrlRequest(album.slug, slug)
      if (!result.ok) {
        setError(result.error)
        showAppToast(result.error, 'error')
        return
      }
      onAlbumUpdated({ custom_slug: result.custom_slug })
      setSaved(true)
      showAppToast(action === 'clear' ? t('ot.customUrlCleared') : t('ot.customUrlSaved'))
      if (action === 'clear') setInput('')
    } catch (e) {
      const message = e instanceof Error ? e.message : t('common.networkError')
      setError(message)
      showAppToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const canSave = row.enabled && !saving && !!input.trim()

  return (
    <section style={settingsSectionStyle}>
      <button type="button" className="hush-motion" style={accordionButton} onClick={onToggle}>
        <Link2 className="w-4 h-4" style={{ color: '#7C5C3E' }} />
        <span style={sectionTitle}>{t('ot.customUrl')}</span>
        <PlanBadge need={FEATURE_TIER.customUrl} tier={userTier} />
        <ChevronDown
          className="ml-auto w-4 h-4 transition-transform"
          style={{ color: '#A89880', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      {open && (
        <div className="px-4 pb-4">
          <p className="text-xs mb-3" style={{ color: '#7C5C3E' }}>
            {t('ot.customUrlSub')}
          </p>
          <div className="flex items-stretch rounded-lg overflow-hidden" style={{ border: '1px solid #DDD5C5', background: '#FDFAF5', ...gatedRowStyle(row.dimmed, !row.show) }}>
            <span className="text-xs flex items-center px-2 select-none" style={{ color: '#A89880' }}>hushare.space/</span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="anna-and-david"
              maxLength={40}
              disabled={!row.enabled}
              className="flex-1 text-sm px-2 py-2 focus:outline-none disabled:cursor-not-allowed"
              style={{ background: 'transparent', color: '#630826' }}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSave) void save('set') }}
            />
          </div>
          {error && <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{error}</p>}
          {saved && !error && <p className="text-xs mt-2" style={{ color: '#630826' }}>{t('ot.saved')}</p>}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => void save('set')}
              disabled={!canSave}
              className="hush-press flex-1 text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#630826', color: '#FDFAF5' }}
            >
              {saving ? t('ot.saving') : t('ot.save')}
            </button>
            {album.custom_slug && (
              <button
                onClick={() => void save('clear')}
                disabled={!row.enabled || saving}
                className="hush-press text-sm rounded-lg py-2 px-3 transition hover:opacity-90 disabled:opacity-50"
                style={{ background: '#F5F0E8', color: '#7C5C3E', border: '1px solid #DDD5C5' }}
              >
                {t('ot.clear')}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
