'use client'

import { useRef, useState } from 'react'
import type { Album } from '@/types'
import { formatDate } from '@/lib/utils'
import { showAppToast } from '@/components/AppToast'
import { useT } from '@/i18n/LocaleProvider'
import Image from 'next/image'
import Link from 'next/link'
import { Check, Pencil, X } from 'lucide-react'
import { contrastText, DEFAULT_ACCENT } from '@/lib/album-design'

type Props = {
  album: Album
  photoCount: number
  isOwner: boolean
  onAlbumUpdated: (patch: Partial<Album>) => void
  // Resolved image URL of the album's cover photo, if one is set. When present, the header becomes
  // a hero banner (photo + overlaid title); when null, it's the accent-colored band.
  coverUrl?: string | null
}

export default function AlbumHeader({ album, photoCount, isOwner, onAlbumUpdated, coverUrl = null }: Props) {
  const { t } = useT()
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
      showAppToast(t('album.titleRequired'), 'error')
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
        showAppToast(body.error ?? t('album.renameFailed'), 'error')
        return
      }
      onAlbumUpdated({ title: body.title })
      setEditing(false)
      showAppToast(t('album.renamed'))
    } catch (e) {
      showAppToast(e instanceof Error ? e.message : t('common.networkError'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const accent = album.accent_color || DEFAULT_ACCENT
  const ink = contrastText(accent)
  const hero = !!coverUrl
  const useLightLogo = hero ? true : ink === '#FDFAF5'
  const fg = hero ? '#FDFAF5' : ink                                  // hero text is always light (over scrim)
  const shadow = hero ? '0 1px 16px rgba(0,0,0,0.55)' : undefined     // legibility over any photo
  const welcome = (album.welcome_message ?? '').trim()

  const logo = (
    <Image
      src={useLightLogo ? '/logo/logo-light-transparent.png' : '/logo/logo-dark-transparent.png'}
      alt="Hushare"
      width={618}
      height={146}
      className="hush-logo"
      style={{ width: 'auto' }}
    />
  )

  // Title + meta + welcome — identical content in both modes; the parent controls alignment.
  const content = (
    <>
      {editing ? (
        <div className={`flex items-center gap-2${hero ? '' : ' mx-auto max-w-md justify-center'}`}>
          <input
            value={title}
            maxLength={120}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveTitle()
              if (e.key === 'Escape') setEditing(false)
            }}
            className="hush-album-title-input min-w-0 flex-1 rounded-lg px-3 py-2 text-lg font-bold focus:outline-none"
            style={{ color: '#630826', background: '#FDFAF5', border: '1px solid #DDD5C5' }}
          />
          <button type="button" onClick={saveTitle} disabled={saving} className="hush-press rounded-lg p-2 disabled:opacity-50" style={{ background: '#630826', color: '#FDFAF5' }} aria-label={t('album.saveTitle')}>
            <Check className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setEditing(false)} className="hush-press rounded-lg p-2" style={{ background: '#F5F0E8', color: '#7C5C3E', border: '1px solid #DDD5C5' }} aria-label={t('album.cancelRename')}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <h1
          className={`hush-album-title text-xl font-bold truncate${isOwner ? ' hush-album-title-editable' : ''}`}
          style={{ color: fg, textShadow: shadow }}
          onDoubleClick={openEditor}
          onPointerDown={(e) => {
            if (!isOwner || e.pointerType === 'mouse') return
            clearHoldTimer()
            holdTimerRef.current = window.setTimeout(openEditor, 700)
          }}
          onPointerUp={clearHoldTimer}
          onPointerCancel={clearHoldTimer}
          onPointerLeave={clearHoldTimer}
          title={isOwner ? t('album.dblclickRename') : undefined}
        >
          {album.title}
          {isOwner && (
            <button
              type="button"
              className="hush-album-title-edit-button ml-2 inline-flex align-middle"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); openEditor() }}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={t('album.rename')}
              title={t('album.rename')}
            >
              <Pencil className="h-3.5 w-3.5 opacity-65" aria-hidden="true" />
            </button>
          )}
        </h1>
      )}
      <p className="hush-album-meta text-xs mt-0.5" style={{ color: fg, opacity: 0.85, textShadow: shadow }}>
        <span>{t('album.photos', { n: photoCount })}</span>
        <span aria-hidden="true"> · </span>
        <span>{t('album.created', { date: formatDate(album.created_at) })}</span>
        {isOwner && (
          <>
            <span className="hush-owner-dot" aria-hidden="true"> · </span>
            <span className="hush-owner-pill font-semibold" style={{ color: fg }}>{t('album.ownerView')}</span>
          </>
        )}
      </p>
      {welcome && (
        <p style={{ color: fg, opacity: 0.92, fontSize: 13.5, lineHeight: 1.5, marginTop: 6, maxWidth: '52ch', textShadow: shadow }}>
          {welcome}
        </p>
      )}
    </>
  )

  // ── Hero mode: cover photo with the title overlaid ──
  if (hero) {
    return (
      <div
        className="hush-album-header-shell"
        style={{
          position: 'relative', overflow: 'hidden',
          minHeight: 'clamp(210px, 38vh, 340px)',
          backgroundColor: accent,
          backgroundImage: `url("${coverUrl}")`,
          backgroundSize: 'cover', backgroundPosition: 'center',
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        }}
      >
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(12,7,10,0.22) 0%, rgba(12,7,10,0) 34%, rgba(12,7,10,0.68) 100%)' }} />
        <Link href="/" aria-label="Hushare home" className="hush-album-logo-link transition hover:opacity-80" style={{ position: 'absolute', top: 16, left: 'clamp(14px, 4vw, 22px)', zIndex: 1, display: 'inline-flex' }}>
          {logo}
        </Link>
        <div className="hush-container" style={{ position: 'relative', zIndex: 1, textAlign: 'left', paddingInline: 'clamp(14px, 4vw, 22px)', paddingBottom: 'clamp(16px, 3vw, 26px)', paddingTop: 64 }}>
          {content}
        </div>
      </div>
    )
  }

  // ── Band mode: accent-colored bar (no cover photo) ──
  return (
    <div className="hush-album-header-shell" style={{ borderBottom: `1px solid ${useLightLogo ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.10)'}`, background: accent }}>
      <div className="hush-container hush-album-header py-6 flex items-center justify-between" style={{ paddingInline: 'clamp(14px, 4vw, 20px)' }}>
        <Link href="/" className="hush-album-logo-link flex items-center transition hover:opacity-70" aria-label="Hushare home">
          {logo}
        </Link>
        <div className="hush-album-title-wrap text-center flex-1 px-4">
          {content}
        </div>
        <div className="hush-album-header-spacer w-24" />
      </div>
    </div>
  )
}
