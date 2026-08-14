'use client'

import { useRef, useState } from 'react'
import type { Album, Photo } from '@/types'
import { formatDate } from '@/lib/utils'
import { showAppToast } from '@/components/AppToast'
import { useT } from '@/i18n/LocaleProvider'
import Image from 'next/image'
import Link from 'next/link'
import { Check, Pencil, X } from 'lucide-react'
import { contrastText, DEFAULT_ACCENT, headerVideoIframeSrc } from '@/lib/album-design'

type Props = {
  album: Album
  photoCount: number
  isOwner: boolean
  onAlbumUpdated: (patch: Partial<Album>) => void
  // Resolved image URL of the album's cover photo, if one is set. When present, the header becomes
  // a hero banner (photo + overlaid title); when null, it's the accent-colored band.
  coverUrl?: string | null
  // Set only when the chosen header photo is a video — the hero then embeds a muted Stream player
  // over the poster (coverUrl). Null keeps the plain static-image hero.
  headerVideo?: Photo | null
}

export default function AlbumHeader({ album, photoCount, isOwner, onAlbumUpdated, coverUrl = null, headerVideo = null }: Props) {
  const { t } = useT()
  const holdTimerRef = useRef<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(album.title)
  const [saving, setSaving] = useState(false)
  const [hoverPlaying, setHoverPlaying] = useState(false)

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
  // A header VIDEO must force hero mode even when its poster is missing. Posters come from Stream
  // and are absent while a freshly-uploaded video is still processing — keying hero purely off
  // coverUrl (the poster) meant the album silently fell back to the plain colour band and the
  // video never appeared at all. The accent colour backs the video until the poster exists.
  const hero = !!coverUrl || !!headerVideo
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

  // Owner's custom logo (paid) — a small mark above the title, distinct from the Hushare brand
  // mark above (which stays a fixed, known-aspect-ratio asset via next/image). An owner upload has
  // an unknown aspect ratio, so it's a plain <img> sized by CSS rather than forcing width/height.
  const ownerLogo = album.logo_url && (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={album.logo_url}
      alt=""
      className={hero ? undefined : 'mx-auto'}
      style={{
        display: 'block', height: hero ? 40 : 32, maxWidth: hero ? 180 : 140,
        objectFit: 'contain', marginBottom: 8,
        filter: hero ? 'drop-shadow(0 1px 6px rgba(0,0,0,0.35))' : undefined,
      }}
    />
  )

  // Title + meta + welcome — identical content in both modes; the parent controls alignment.
  const content = (
    <>
      {ownerLogo}
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
          style={{
            color: fg,
            textShadow: shadow,
            fontFamily: 'var(--album-font, var(--font-serif))',
            letterSpacing: '-0.01em',
            // In hero (cover) mode the title is the headline of the whole album — give it real presence.
            ...(hero ? { fontSize: 'clamp(1.7rem, 5vw, 2.5rem)', lineHeight: 1.08 } : { fontSize: 'clamp(1.25rem, 3.4vw, 1.55rem)' }),
          }}
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
          {/* Invisible left spacer balances the edit pencil so the CENTERED (band) title stays truly
              centered. Skipped in hero mode, where the title is left-aligned. */}
          {isOwner && !hero && <span aria-hidden="true" style={{ display: 'inline-block', width: '1.4rem', verticalAlign: 'middle' }} />}
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
        <p style={{
          color: fg, opacity: 0.9, fontFamily: 'var(--album-font, var(--font-serif))', fontStyle: 'italic',
          fontSize: 15, lineHeight: 1.5, marginTop: 8, maxWidth: '46ch', textShadow: shadow,
          ...(hero ? {} : { marginInline: 'auto', textAlign: 'center' as const }),
        }}>
          {welcome}
        </p>
      )}
    </>
  )

  // Sponsor-branding strip (race/festival albums, paid) — a thin bar right below the header, shown
  // only when the owner has added at least one sponsor. Deliberately outside the accent-colored
  // header itself so sponsor marks sit on a neutral background regardless of the chosen accent.
  const sponsorStrip = album.sponsor_logos.length > 0 && (
    <div style={{ background: '#FDFAF5', borderBottom: '1px solid #EFE7D8', padding: '10px 14px' }}>
      <div className="hush-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A89880' }}>{t('album.sponsors')}</span>
        {album.sponsor_logos.map((s) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={s.id} src={s.url} alt={s.name ?? ''} style={{ height: 26, maxWidth: 96, objectFit: 'contain' }} />
        ))}
      </div>
    </div>
  )

  // ── Hero mode: cover photo with the title overlaid ──
  if (hero) {
    // A video header renders a muted Stream iframe ON TOP of its own poster (which stays as the
    // shell's background, so there's never a blank frame while the player loads, and the hover
    // modes have something to show when paused). Hover modes are pointer-driven, so on touch
    // devices — which never fire hover — the poster is simply what guests see.
    const videoMode = album.header_video_mode ?? 'loop'
    const isHoverMode = videoMode === 'hoverPlay' || videoMode === 'hoverLoop'
    const showVideo = !!headerVideo && (!isHoverMode || hoverPlaying)
    const videoSrc = headerVideo ? headerVideoIframeSrc(headerVideo, videoMode, true) : ''

    return (
      <>
        <div
          className="hush-album-header-shell"
          style={{
            position: 'relative', overflow: 'hidden',
            minHeight: 'clamp(210px, 38vh, 340px)',
            backgroundColor: accent,
            // No poster yet (video still processing) → no backgroundImage, accent shows through.
            ...(coverUrl ? { backgroundImage: `url("${coverUrl}")` } : {}),
            // "cover" is the 100% baseline; a zoom scales past it. background-position then decides
            // which part of the enlarged image stays in frame, which is why the two work together.
            backgroundSize: album.header_zoom && album.header_zoom > 100 ? `${album.header_zoom}% auto` : 'cover',
            backgroundPosition: album.header_focal || 'center',
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          }}
          onPointerEnter={isHoverMode ? () => setHoverPlaying(true) : undefined}
          onPointerLeave={isHoverMode ? () => setHoverPlaying(false) : undefined}
        >
          {showVideo && videoSrc && (
            // Fades in rather than appearing instantly: a Stream iframe paints black for a beat
            // before the first frame arrives, which read as a flicker over the poster. The poster
            // stays visible underneath during the fade, so the transition is seamless.
            // (objectFit was removed — it does nothing on an iframe.)
            <iframe
              key={`${headerVideo!.id}-${videoMode}-${hoverPlaying}`}
              className="hush-header-video"
              src={videoSrc}
              title=""
              aria-hidden="true"
              tabIndex={-1}
              // NO `encrypted-media`. It enables EME (DRM), which makes Windows treat the window as
              // protected content — screen recorders (Snipping Tool, OBS) then stop or capture black,
              // which made it impossible to record a demo of our own product. Hushare's Stream videos
              // are not DRM-protected, so the permission bought nothing. Do not add it back.
              allow="autoplay"
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                border: 'none', pointerEvents: 'none',
                // Zoom + reposition for VIDEO headers. We can't crop inside the Stream player, but
                // the iframe is an ordinary element, so scaling it and anchoring the scale at the
                // focal point gives the same result — the shell's overflow:hidden does the cropping.
                // transform-origin takes the same "X% Y%" that background-position takes for photos,
                // so a header behaves identically whether it's a photo or a video.
                // Bonus: zooming past 100% also crops away the letterbox bars the player adds when
                // the video's aspect ratio doesn't match the banner.
                ...(album.header_zoom && album.header_zoom > 100
                  ? { transform: `scale(${album.header_zoom / 100})`, transformOrigin: album.header_focal || 'center' }
                  : {}),
              }}
            />
          )}
          {/* pointerEvents:none — this scrim covers the whole header, so without it it would sit
              between the cursor and anything beneath it. */}
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(180deg, rgba(12,7,10,0.22) 0%, rgba(12,7,10,0) 34%, rgba(12,7,10,0.68) 100%)' }} />
          {/* zIndex 2, above the title block's 1. The title block is a full-width flex child with
              64px of top padding, and that padding lands right on top of this logo — at equal
              z-index the later element won and ate every click, so the logo stopped being a link. */}
          <Link href="/" aria-label="Hushare home" className="hush-album-logo-link transition hover:opacity-80" style={{ position: 'absolute', top: 16, left: 'clamp(14px, 4vw, 22px)', zIndex: 2, display: 'inline-flex' }}>
            {logo}
          </Link>
          <div className="hush-container" style={{ position: 'relative', zIndex: 1, textAlign: 'left', paddingInline: 'clamp(14px, 4vw, 22px)', paddingBottom: 'clamp(16px, 3vw, 26px)', paddingTop: 64 }}>
            {content}
          </div>
        </div>
        {sponsorStrip}
      </>
    )
  }

  // ── Band mode: accent-colored bar (no cover photo) ──
  return (
    <>
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
      {sponsorStrip}
    </>
  )
}
