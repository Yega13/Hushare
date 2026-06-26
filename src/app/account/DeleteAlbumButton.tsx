'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { showAccountToast, TOAST_STORAGE_KEY } from './AccountToastViewport'

type Props = {
  albumId: string
}

export default function DeleteAlbumButton({ albumId }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function deleteAlbum() {
    if (deleting) return
    if (!confirming) {
      setConfirming(true)
      setError('')
      return
    }

    setDeleting(true)
    setError('')
    try {
      const res = await fetch('/api/account/albums/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ album_id: albumId }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        const message = body.error ?? `Delete failed (${res.status})`
        setError(message)
        showAccountToast(message, 'error')
        return
      }
      window.sessionStorage.setItem(TOAST_STORAGE_KEY, JSON.stringify({ message: 'Album deleted' }))
      window.location.reload()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Network error'
      setError(message)
      showAccountToast(message, 'error')
      // Reset confirming so the next click re-runs the two-step flow instead of retrying immediately
      setConfirming(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className={`hush-delete-dialog mt-2 ${confirming ? 'hush-delete-dialog-open' : ''}`}>
      <button
        type="button"
        onClick={deleteAlbum}
        disabled={deleting}
        className="hush-delete-primary hush-press inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          background: confirming ? '#C0392B' : '#FFFFFF',
          border: '1px solid #C0392B',
          color: confirming ? '#FFFFFF' : '#C0392B',
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {deleting ? 'Deleting...' : confirming ? 'Confirm delete' : 'Delete'}
      </button>
      {confirming && (
        <div className="hush-delete-confirm-family">
          <p role="alert">Delete this album forever?</p>
          <button
            type="button"
            onClick={() => { setConfirming(false); setError('') }}
            className="hush-press rounded-lg px-2.5 py-1.5 text-xs font-semibold transition"
            style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#7C5C3E' }}
          >
            Cancel
          </button>
        </div>
      )}
      {error && <span className="basis-full text-xs" style={{ color: '#C0392B' }}>{error}</span>}
    </div>
  )
}
