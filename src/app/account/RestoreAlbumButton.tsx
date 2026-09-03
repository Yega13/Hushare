'use client'

import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { showAccountToast, TOAST_STORAGE_KEY } from './AccountToastViewport'
import { useT } from '@/i18n/LocaleProvider'

type Props = {
  albumId: string
  /** How many days are left before the album is destroyed for good. */
  daysLeft: number | null
}

// PUTTING A DELETED ALBUM BACK, from the one page an owner can still find it on.
//
// Deleting hides the album everywhere, so the album's own page cannot offer the undo after the
// moment of deleting — the owner navigates away and the door is shut. This is the door that stays
// open for the whole window, and it is the reason the account page lists binned albums separately
// instead of filtering them out.
//
// No confirmation step, deliberately: restoring is not destructive, and a two-step flow on the
// recovery path is friction in front of somebody who has already had a bad afternoon.
export default function RestoreAlbumButton({ albumId, daysLeft }: Props) {
  const { t } = useT()
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState('')

  async function restore() {
    if (restoring) return
    setRestoring(true)
    setError('')
    try {
      const res = await fetch('/api/account/albums/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ album_id: albumId }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        const message = body.error ?? t('acct.restoreFailed', { status: res.status })
        setError(message)
        showAccountToast(message, 'error')
        return
      }
      window.sessionStorage.setItem(TOAST_STORAGE_KEY, JSON.stringify({ message: t('ot.albumRestored') }))
      window.location.reload()
    } catch (e) {
      const message = e instanceof Error ? e.message : t('common.networkError')
      setError(message)
      showAccountToast(message, 'error')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={restore}
        disabled={restoring}
        className="hush-press inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
        style={{ background: '#FFFFFF', border: '1px solid #630826', color: '#630826' }}
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {restoring ? t('ot.restoring') : t('ot.undoDelete')}
      </button>
      {daysLeft !== null && (
        <p className="mt-1.5 text-xs" style={{ color: '#7A2A1F' }}>
          {t('ot.restorableFor').replace('{days}', String(daysLeft))}
        </p>
      )}
      {error && <p className="mt-1.5 text-xs" style={{ color: '#C0392B' }}>{error}</p>}
    </div>
  )
}
