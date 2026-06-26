'use client'

import { useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { showAccountToast, TOAST_STORAGE_KEY } from './AccountToastViewport'

type Props = {
  albumId: string
  title: string
}

export default function RenameAlbumButton({ albumId, title: initialTitle }: Props) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState(initialTitle)

  async function saveTitle() {
    if (saving) return
    const nextTitle = title.trim().slice(0, 120)
    if (!nextTitle) {
      showAccountToast('Album title is required', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/account/albums/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ album_id: albumId, title: nextTitle }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        showAccountToast(body.error ?? `Rename failed (${res.status})`, 'error')
        return
      }
      window.sessionStorage.setItem(TOAST_STORAGE_KEY, JSON.stringify({ message: 'Album renamed' }))
      window.location.reload()
    } catch (e) {
      showAccountToast(e instanceof Error ? e.message : 'Network error', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="mt-2 rounded-xl p-2" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          autoFocus
          className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void saveTitle()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveTitle}
            disabled={saving}
            className="hush-press inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-60"
            style={{ background: '#254F22', color: '#FDFAF5' }}
          >
            <Check className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => { setEditing(false); setTitle(initialTitle) }}
            className="hush-press inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition"
            style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#7C5C3E' }}
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="hush-press mt-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition"
      style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#7C5C3E' }}
    >
      <Pencil className="h-3.5 w-3.5" />
      Rename
    </button>
  )
}
