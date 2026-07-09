'use client'

import { useState } from 'react'
import { Check, Copy, Pencil, X } from 'lucide-react'
import DeleteCollectionButton from './DeleteCollectionButton'
import { showAccountToast, TOAST_STORAGE_KEY } from './AccountToastViewport'

type Props = {
  collection: {
    id: string
    name: string
    slug: string
    description: string | null
  }
}

export default function CollectionActions({ collection }: Props) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState(collection.name)
  const [slug, setSlug] = useState(collection.slug)
  const [description, setDescription] = useState(collection.description ?? '')

  async function copyLink() {
    // Build URL inside the handler so window.location is only accessed in a browser event,
    // not during SSR — avoids hydration mismatches on server-rendered client components.
    const url = `${window.location.origin}/c/${collection.slug}`
    try {
      await navigator.clipboard.writeText(url)
      showAccountToast('Collection link copied')
    } catch {
      showAccountToast('Could not copy collection link', 'error')
    }
  }

  async function saveEdit() {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/collections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection_id: collection.id,
          name,
          collection_slug: slug,
          description,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        showAccountToast(body.error ?? `Save failed (${res.status})`, 'error')
        return
      }
      window.sessionStorage.setItem(TOAST_STORAGE_KEY, JSON.stringify({ message: 'Collection updated' }))
      window.location.reload()
    } catch (e) {
      showAccountToast(e instanceof Error ? e.message : 'Network error', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="mt-3 rounded-xl p-3" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
        <div className="grid gap-2">
          <input
            aria-label="Collection name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#630826' }}
          />
          <input
            aria-label="Collection slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            maxLength={40}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#630826' }}
          />
          <textarea
            aria-label="Collection description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={240}
            rows={3}
            className="w-full resize-none rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#630826' }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveEdit}
            disabled={saving || !name.trim() || !slug.trim()}
            className="hush-press inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: '#630826', color: '#FDFAF5' }}
          >
            <Check className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false)
              setName(collection.name)
              setSlug(collection.slug)
              setDescription(collection.description ?? '')
            }}
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
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={copyLink}
        className="hush-press inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition"
        style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#630826' }}
      >
        <Copy className="h-3.5 w-3.5" />
        Copy link
      </button>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="hush-press inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition"
        style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#7C5C3E' }}
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </button>
      <DeleteCollectionButton collectionId={collection.id} />
    </div>
  )
}
