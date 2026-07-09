'use client'

import { useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { showAccountToast, TOAST_STORAGE_KEY } from './AccountToastViewport'

function slugFromName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'collection'
  )
}

export default function CreateCollectionButton() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  function reset() {
    setOpen(false)
    setName('')
    setDescription('')
  }

  async function create() {
    if (saving) return
    const trimmedName = name.trim()
    if (!trimmedName) return
    if (trimmedName.length < 4) {
      showAccountToast('Collection name must be at least 4 characters', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim(),
          collection_slug: slugFromName(trimmedName),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        showAccountToast(body.error ?? `Could not create collection (${res.status})`, 'error')
        return
      }
      window.sessionStorage.setItem(TOAST_STORAGE_KEY, JSON.stringify({ message: 'Collection created' }))
      window.location.reload()
    } catch (e) {
      showAccountToast(e instanceof Error ? e.message : 'Network error', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hush-press inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition"
        style={{ background: '#F6E9EE', color: '#630826', border: '1px solid #C8D8C4' }}
      >
        <Plus className="h-3.5 w-3.5" />
        New collection
      </button>
    )
  }

  return (
    <div className="mt-3 rounded-xl p-3" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
      <div className="grid gap-2">
        <input
          aria-label="Collection name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="Collection name"
          className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#630826' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
            if (e.key === 'Escape') reset()
          }}
        />
        <textarea
          aria-label="Collection description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={240}
          rows={2}
          placeholder="Description (optional)"
          className="w-full resize-none rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#630826' }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void create()}
          disabled={saving || !name.trim()}
          className="hush-press inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: '#630826', color: '#FDFAF5' }}
        >
          <Check className="h-3.5 w-3.5" />
          {saving ? 'Creating...' : 'Create'}
        </button>
        <button
          type="button"
          onClick={reset}
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
