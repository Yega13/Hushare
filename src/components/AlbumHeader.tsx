'use client'

import { useRef, useState } from 'react'
import type { Album } from '@/types'
import { formatDate } from '@/lib/utils'
import { showAppToast } from '@/components/AppToast'
import Image from 'next/image'
import Link from 'next/link'
import { Check, Pencil, X } from 'lucide-react'

type Props = {
  album: Album
  photoCount: number
  isOwner: boolean
  onAlbumUpdated: (patch: Partial<Album>) => void
}

export default function AlbumHeader({ album, photoCount, isOwner, onAlbumUpdated }: Props) {
  const holdTimerRef = useRef<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(album.title)
  const [saving, setSaving] = useState(false)

  function clearHoldTimer() {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  function openEditor() {
    if (!isOwner) return
    setTitle(album.title)
    setEditing(true)
  }

  async function saveTitle() {
    if (!isOwner || saving) return
    const nextTitle = title.trim().slice(0, 120)
    if (!nextTitle) {
      showAppToast('Album title is required.', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/album/title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: album.slug, title: nextTitle }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; title?: string }
      if (!res.ok || !body.title) {
        showAppToast(body.error ?? `Rename failed (${res.status})`, 'error')
        return
      }
      onAlbumUpdated({ title: body.title })
      setEditing(false)
      showAppToast('Album renamed.')
    } catch (e) {
      showAppToast(e instanceof Error ? e.message : 'Network error', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="hush-album-header-shell" style={{ borderBottom: '1px solid #DDD5C5', background: '#FDFAF5' }}>
      <div className="hush-container hush-album-header py-6 flex items-center justify-between" style={{ paddingInline: 'clamp(14px, 4vw, 20px)' }}>
        <Link href="/" className="hush-album-logo-link flex items-center transition hover:opacity-70" aria-label="Hushare home">
          <Image
            src="/logo/logo-dark-transparent.png"
            alt="Hushare"
            width={618}
            height={146}
            className="hush-logo"
            style={{ width: 'auto' }}
          />
        </Link>

        <div className="hush-album-title-wrap text-center flex-1 px-4">
          {editing ? (
            <div className="mx-auto flex max-w-md items-center justify-center gap-2">
              <input
                value={title}
                maxLength={120}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveTitle()
                  if (e.key === 'Escape') setEditing(false)
                }}
                className="hush-album-title-input min-w-0 flex-1 rounded-lg px-3 py-2 text-center text-lg font-bold focus:outline-none"
                style={{ color: '#630826', background: '#FDFAF5', border: '1px solid #DDD5C5' }}
              />
              <button type="button" onClick={saveTitle} disabled={saving} className="hush-press rounded-lg p-2 disabled:opacity-50" style={{ background: '#630826', color: '#FDFAF5' }} aria-label="Save album title">
                <Check className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setEditing(false)} className="hush-press rounded-lg p-2" style={{ background: '#F5F0E8', color: '#7C5C3E', border: '1px solid #DDD5C5' }} aria-label="Cancel rename">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <h1
              className={`hush-album-title text-xl font-bold truncate${isOwner ? ' hush-album-title-editable' : ''}`}
              style={{ color: '#630826' }}
              onDoubleClick={openEditor}
              onPointerDown={(e) => {
                if (!isOwner || e.pointerType === 'mouse') return
                clearHoldTimer()
                holdTimerRef.current = window.setTimeout(openEditor, 700)
              }}
              onPointerUp={clearHoldTimer}
              onPointerCancel={clearHoldTimer}
              onPointerLeave={clearHoldTimer}
              title={isOwner ? 'Double-click to rename' : undefined}
            >
              {album.title}
              {isOwner && (
                <button
                  type="button"
                  className="hush-album-title-edit-button ml-2 inline-flex align-middle"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openEditor()
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label="Rename album"
                  title="Rename album"
                >
                  <Pencil className="h-3.5 w-3.5 opacity-65" aria-hidden="true" />
                </button>
              )}
            </h1>
          )}
          <p className="hush-album-meta text-xs mt-0.5" style={{ color: '#7C5C3E' }}>
            <span>{photoCount} photo{photoCount !== 1 ? 's' : ''}</span>
            <span aria-hidden="true"> · </span>
            <span>Created {formatDate(album.created_at)}</span>
            {isOwner && (
              <>
                <span className="hush-owner-dot" aria-hidden="true"> · </span>
                <span className="hush-owner-pill font-semibold" style={{ color: '#1B3A6B' }}>Owner view</span>
              </>
            )}
          </p>
        </div>

        <div className="hush-album-header-spacer w-24" />
      </div>
    </div>
  )
}
