'use client'

import { useCallback, useRef, useState, type CSSProperties } from 'react'
import { Loader2, Plus, X, Play, ChevronUp, ChevronDown } from 'lucide-react'
import type { Album, Photo, SponsorLogo, HeaderVideoMode } from '@/types'
import AlbumHeader from '@/components/AlbumHeader'
import HushColorPicker from '@/components/HushColorPicker'
import { showAppToast } from '@/components/AppToast'
import { useT } from '@/i18n/LocaleProvider'
import {
  ALBUM_FONTS, ACCENT_PALETTE, DEFAULT_ACCENT, contrastText, fontStack,
  ALBUM_PHOTO_STYLES, photoStyleTile, resolveHeaderImageUrl, resolveHeaderVideo,
  isImageBackground, getBackgroundImageUrl, getBackgroundColorStyle, HEADER_VIDEO_MODES,
} from '@/lib/album-design'
import {
  saveDesignRequest, saveBackgroundRequest, uploadBackgroundRequest, saveHeaderImageRequest, uploadHeaderImageFile,
  saveLogoRequest, uploadLogoFile, saveSponsorsRequest, uploadSponsorLogoFile,
} from '@/components/owner-toolbar/api'
import { PRESETS, DEFAULT_BG, DESIGN_IMAGE_TYPES, MAX_DESIGN_IMAGE_BYTES, MAX_LOGO_BYTES } from '@/components/owner-toolbar/constants'
import { STOCK_ALBUM_BACKGROUNDS } from '@/lib/album-backgrounds'
import { formatFileSize } from '@/lib/utils'

const INK = '#2A211C', MUTED = '#8A7A66', BORDER = '#DDD5C5', BRAND = '#630826'
// Hard safety cap on the header-photo picker so an extreme-sized album can't render thousands of
// candidate tiles at once. The picker is scrollable within its own box, so in practice every
// normal-sized album shows ALL of its photos, not just a first handful.
const HEADER_PICKER_MAX = 200
// Matches MAX_SPONSORS in /api/album/sponsors — a strip is a handful of marks, not a scroller.
const MAX_SPONSORS = 12

type SaveResult = { ok: boolean; error?: string }
type Props = {
  album: Album
  photos: Photo[]
  onAlbumUpdated: (patch: Partial<Album>) => void
  onClose: () => void
}

const label: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#7C5C3E', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }
const section: React.CSSProperties = { padding: '16px 0', borderBottom: `1px solid #EFE7D8` }

export default function AlbumDesigner({ album, photos, onAlbumUpdated, onClose }: Props) {
  const { t } = useT()
  const [accentHex, setAccentHex] = useState(album.accent_color || DEFAULT_ACCENT)
  const accentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks whether a header-photo clear triggered by picking a colour has already been sent for
  // the CURRENT header photo, so dragging the native colour input (which can fire many times before
  // React re-renders album.cover_photo_id back to null) doesn't spam /api/album/cover — that
  // endpoint shares its rate-limit bucket with the accent-colour save itself.
  const clearedHeaderPhotoRef = useRef(false)
  const [uploadingHeader, setUploadingHeader] = useState(false)
  const [headerUploadError, setHeaderUploadError] = useState('')
  const headerFileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoUploadError, setLogoUploadError] = useState('')
  const logoFileInputRef = useRef<HTMLInputElement>(null)
  const [bgColorHex, setBgColorHex] = useState(/^#[0-9a-f]{6}$/i.test(album.background_theme ?? '') ? (album.background_theme as string) : DEFAULT_BG)
  const bgColorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [uploadingBg, setUploadingBg] = useState(false)
  const [bgUploadError, setBgUploadError] = useState('')
  const bgFileInputRef = useRef<HTMLInputElement>(null)
  const [showAllAccents, setShowAllAccents] = useState(false)
  const [showAccentPicker, setShowAccentPicker] = useState(false)
  const [showBgPicker, setShowBgPicker] = useState(false)
  const [uploadingSponsor, setUploadingSponsor] = useState(false)
  const [sponsorError, setSponsorError] = useState('')
  const sponsorFileInputRef = useRef<HTMLInputElement>(null)

  // Optimistic + persist, reverting on failure. `saver` returns {ok,error}.
  const persist = useCallback(async (patch: Partial<Album>, saver: () => Promise<SaveResult>) => {
    const prev: Record<string, unknown> = {}
    for (const k of Object.keys(patch)) prev[k] = (album as unknown as Record<string, unknown>)[k]
    onAlbumUpdated(patch)
    try {
      const res = await saver()
      if (!res.ok) { onAlbumUpdated(prev as Partial<Album>); showAppToast(res.error ?? t('common.networkError'), 'error') }
    } catch {
      onAlbumUpdated(prev as Partial<Album>); showAppToast(t('common.networkError'), 'error')
    }
  }, [album, onAlbumUpdated, t])

  const setFont = (key: string) => persist({ title_font: key === 'serif' ? null : key }, () => saveDesignRequest(album.slug, { title_font: key === 'serif' ? null : key }))
  const setPhotoStyle = (key: string) => persist({ photo_style: key === 'default' ? null : key }, () => saveDesignRequest(album.slug, { photo_style: key }))
  const setWelcome = (text: string) => { const v = text.replace(/\s+/g, ' ').trim().slice(0, 200) || null; persist({ welcome_message: v }, () => saveDesignRequest(album.slug, { welcome_message: v })) }
  const setBackground = (theme: string | null) => persist({ background_theme: theme }, () => saveBackgroundRequest(album.slug, theme))
  const setHeaderVideoMode = (mode: HeaderVideoMode) => persist({ header_video_mode: mode }, () => saveDesignRequest(album.slug, { header_video_mode: mode }))

  // Where the header photo/video is anchored within the hero band's crop. Dragging on the live
  // preview updates the position instantly (optimistic, no network) and saves debounced — same
  // pattern as the accent colour picker, since a pointer drag can fire many times a second.
  const focalTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focalDraggingRef = useRef(false)
  function parseFocal(v: string | null): { x: number; y: number } {
    const m = v ? /^(\d{1,3})% (\d{1,3})%$/.exec(v) : null
    return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 50, y: 50 }
  }
  function applyFocalFromEvent(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.round(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)))
    const y = Math.round(Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)))
    const value = `${x}% ${y}%`
    onAlbumUpdated({ header_focal: value })
    if (focalTimer.current) clearTimeout(focalTimer.current)
    focalTimer.current = setTimeout(() => { void persist({ header_focal: value }, () => saveDesignRequest(album.slug, { header_focal: value })) }, 350)
  }
  function onFocalPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    focalDraggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    applyFocalFromEvent(e)
  }
  function onFocalPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!focalDraggingRef.current) return
    applyFocalFromEvent(e)
  }
  function onFocalPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    focalDraggingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }

  // Zoom: same optimistic-now, save-debounced shape as the focal drag — a range input fires on
  // every pixel of travel, and each save would otherwise be its own rate-limited request.
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function onHeaderZoom(pct: number) {
    const z = Math.min(300, Math.max(100, Math.round(pct)))
    onAlbumUpdated({ header_zoom: z })
    if (zoomTimer.current) clearTimeout(zoomTimer.current)
    zoomTimer.current = setTimeout(() => { void persist({ header_zoom: z }, () => saveDesignRequest(album.slug, { header_zoom: z })) }, 350)
  }

  // Debounced like the accent-colour picker (same native-input-fires-constantly issue) — the
  // difference is background has nothing else to clear, so no cross-field ref guard is needed.
  const onBackgroundHex = (hex: string) => {
    setBgColorHex(hex)
    onAlbumUpdated({ background_theme: hex }) // live preview
    if (bgColorTimer.current) clearTimeout(bgColorTimer.current)
    bgColorTimer.current = setTimeout(() => { void persist({ background_theme: hex }, () => saveBackgroundRequest(album.slug, hex)) }, 420)
  }

  async function handleAddBackground(file: File) {
    setBgUploadError('')
    if (!DESIGN_IMAGE_TYPES.has(file.type)) {
      const msg = t('ot.badImageFormat')
      setBgUploadError(msg)
      showAppToast(msg, 'error')
      return
    }
    if (file.size > MAX_DESIGN_IMAGE_BYTES) {
      const msg = t('ad.backgroundTooLarge', { size: formatFileSize(MAX_DESIGN_IMAGE_BYTES) })
      setBgUploadError(msg)
      showAppToast(msg, 'error')
      return
    }
    setUploadingBg(true)
    const prevTheme = album.background_theme ?? null
    onAlbumUpdated({ background_theme: null }) // clear to the default while the upload is in flight
    const result = await uploadBackgroundRequest(album.slug, file)
    setUploadingBg(false)
    if (!result.ok) {
      onAlbumUpdated({ background_theme: prevTheme })
      setBgUploadError(result.error)
      showAppToast(result.error, 'error')
      return
    }
    onAlbumUpdated({ background_theme: result.background_theme })
  }

  // Picking an existing photo as the header replaces any custom-uploaded header photo — the two
  // are mutually exclusive (server-enforced too; this optimistic patch just mirrors it instantly).
  const setCover = (photoId: string | null) => {
    // A real photo means there's something to clear again later; null means it's already clear.
    clearedHeaderPhotoRef.current = photoId === null
    return persist({ cover_photo_id: photoId, header_image: null }, async () => {
      const r = await fetch('/api/album/cover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: album.slug, photo_id: photoId }) })
      if (r.ok) return { ok: true }
      const b = await r.json().catch(() => ({})) as { error?: string }
      return { ok: false, error: b.error }
    })
  }

  async function handleAddHeaderPhoto(file: File) {
    setHeaderUploadError('')
    if (!DESIGN_IMAGE_TYPES.has(file.type)) {
      const msg = t('ot.badImageFormat')
      setHeaderUploadError(msg)
      showAppToast(msg, 'error')
      return
    }
    if (file.size > MAX_DESIGN_IMAGE_BYTES) {
      const msg = t('ad.headerPhotoTooLarge', { size: formatFileSize(MAX_DESIGN_IMAGE_BYTES) })
      setHeaderUploadError(msg)
      showAppToast(msg, 'error')
      return
    }
    setUploadingHeader(true)
    const uploaded = await uploadHeaderImageFile(album.slug, file)
    setUploadingHeader(false)
    if (!uploaded.ok) {
      setHeaderUploadError(uploaded.error)
      showAppToast(uploaded.error, 'error')
      return
    }
    // A new header photo is active — a future colour pick needs to be able to clear it again.
    clearedHeaderPhotoRef.current = false
    void persist({ header_image: uploaded.url, cover_photo_id: null }, () => saveHeaderImageRequest(album.slug, uploaded.url))
  }

  const setLogo = (url: string | null) => persist({ logo_url: url }, () => saveLogoRequest(album.slug, url))

  async function handleAddLogo(file: File) {
    setLogoUploadError('')
    if (!DESIGN_IMAGE_TYPES.has(file.type)) {
      const msg = t('ot.badImageFormat')
      setLogoUploadError(msg)
      showAppToast(msg, 'error')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      const msg = t('ad.logoTooLarge', { size: formatFileSize(MAX_LOGO_BYTES) })
      setLogoUploadError(msg)
      showAppToast(msg, 'error')
      return
    }
    setUploadingLogo(true)
    const uploaded = await uploadLogoFile(album.slug, file)
    setUploadingLogo(false)
    if (!uploaded.ok) {
      setLogoUploadError(uploaded.error)
      showAppToast(uploaded.error, 'error')
      return
    }
    setLogo(uploaded.url)
  }

  // Sponsor strip — replace-whole-array: every mutation (add/remove/reorder) computes the full
  // next list client-side and sends that, matching /api/album/sponsors's replace semantics.
  const setSponsors = (next: SponsorLogo[]) => persist({ sponsor_logos: next }, () => saveSponsorsRequest(album.slug, next))

  async function handleAddSponsor(file: File) {
    if (album.sponsor_logos.length >= MAX_SPONSORS) return
    setSponsorError('')
    if (!DESIGN_IMAGE_TYPES.has(file.type)) {
      const msg = t('ot.badImageFormat')
      setSponsorError(msg)
      showAppToast(msg, 'error')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      const msg = t('ad.logoTooLarge', { size: formatFileSize(MAX_LOGO_BYTES) })
      setSponsorError(msg)
      showAppToast(msg, 'error')
      return
    }
    setUploadingSponsor(true)
    const uploaded = await uploadSponsorLogoFile(album.slug, file)
    setUploadingSponsor(false)
    if (!uploaded.ok) {
      setSponsorError(uploaded.error)
      showAppToast(uploaded.error, 'error')
      return
    }
    const entry: SponsorLogo = { id: crypto.randomUUID(), url: uploaded.url, name: null }
    void setSponsors([...album.sponsor_logos, entry])
  }

  function removeSponsor(id: string) {
    void setSponsors(album.sponsor_logos.filter((s) => s.id !== id))
  }

  function moveSponsor(id: string, dir: -1 | 1) {
    const list = album.sponsor_logos
    const i = list.findIndex((s) => s.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    const next = list.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    void setSponsors(next)
  }

  // Header colour is mutually exclusive with a header photo: picking a colour clears whichever
  // photo (custom upload or chosen album photo) is currently set, so the change is visible right
  // away instead of being silently hidden behind the photo.
  const setAccent = (color: string) => {
    const hasHeaderPhoto = (!!album.cover_photo_id || !!album.header_image) && !clearedHeaderPhotoRef.current
    if (hasHeaderPhoto) setCover(null)
    void persist({ accent_color: color }, () => saveDesignRequest(album.slug, { accent_color: color }))
  }
  const onAccentHex = (hex: string) => {
    setAccentHex(hex)
    const hasHeaderPhoto = (!!album.cover_photo_id || !!album.header_image) && !clearedHeaderPhotoRef.current
    if (hasHeaderPhoto) setCover(null)
    onAlbumUpdated({ accent_color: hex }) // live preview
    if (accentTimer.current) clearTimeout(accentTimer.current)
    accentTimer.current = setTimeout(() => { void persist({ accent_color: hex }, () => saveDesignRequest(album.slug, { accent_color: hex })) }, 420)
  }

  const bgTheme = album.background_theme ?? DEFAULT_BG
  const bgIsImage = isImageBackground(album.background_theme)
  const bgImageUrl = bgIsImage && album.background_theme ? getBackgroundImageUrl(album.background_theme) : ''
  const bgColorStyle = getBackgroundColorStyle(album.background_theme)
  const cover = resolveHeaderImageUrl(album, photos)
  const headerVideo = resolveHeaderVideo(album, photos)
  const currentFont = album.title_font ?? 'serif'
  const currentAccent = album.accent_color || DEFAULT_ACCENT
  const currentStyle = album.photo_style ?? 'default'
  const { radius: sampleRadius, framed } = photoStyleTile(album.photo_style, album.media_radius ?? 12)
  const sample = photos.slice(0, 9)
  const focal = parseFocal(album.header_focal)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 120, background: '#FAF7F1', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{ height: 56, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', borderBottom: `1px solid ${BORDER}`, background: '#FFFFFF' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: BRAND, fontFamily: 'var(--font-serif)' }}>{t('ad.title')}</div>
        <button type="button" onClick={onClose} className="hush-press" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: BRAND, color: '#FDFAF5', border: 'none', borderRadius: 10, padding: '8px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          {t('ad.done')}
        </button>
      </div>

      {/* Body: preview + rail. On desktop each pane scrolls INDEPENDENTLY (see album.css) so
          scrolling the settings rail never moves your place in the album preview, and vice versa.
          On narrow screens they stack and the whole body scrolls as one, which is the only thing
          that makes sense when they're above/below each other rather than side by side. */}
      <div className="hush-designer-body" style={{ flex: 1, minHeight: 0, display: 'flex', flexWrap: 'wrap' }}>
        {/* Live preview — the real header + a sample grid + the real page background, all driven
            by the (optimistic) album so every setting shows its effect immediately. */}
        <div
          className="hush-designer-preview"
          style={{
            // minWidth 0, not 300: a hard px floor on a flex child stops it shrinking and pushes
            // the whole designer wider than a small phone, which scrolls the page sideways.
            flex: '1 1 460px', minWidth: 0,
            ...bgColorStyle,
            ...(bgImageUrl ? { backgroundImage: `url("${bgImageUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
            '--album-font': fontStack(album.title_font),
          } as CSSProperties}
        >
          <div style={{ position: 'relative' }}>
            <AlbumHeader album={album} photoCount={photos.length} isOwner={false} onAlbumUpdated={() => {}} coverUrl={cover} headerVideo={headerVideo} />
            {cover && (
              <div
                onPointerDown={onFocalPointerDown}
                onPointerMove={onFocalPointerMove}
                onPointerUp={onFocalPointerUp}
                onPointerCancel={onFocalPointerUp}
                title={t('ad.dragToPosition')}
                style={{ position: 'absolute', inset: 0, cursor: 'crosshair', touchAction: 'none', zIndex: 2 }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute', left: `${focal.x}%`, top: `${focal.y}%`, transform: 'translate(-50%, -50%)',
                    width: 22, height: 22, borderRadius: '50%', border: '2px solid #FDFAF5',
                    boxShadow: '0 0 0 2px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.4)', pointerEvents: 'none',
                  }}
                />
              </div>
            )}
          </div>
          <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: framed ? 12 : 8 }}>
            {sample.map((p) => {
              const thumb = p.media_type === 'video' ? (p.poster_url || p.stream_thumbnail_url || p.thumb_url || '') : (p.thumb_url || p.url || '')
              return (
                <div key={p.id} style={{ aspectRatio: '1', borderRadius: sampleRadius, border: framed ? '6px solid #FFFFFF' : undefined, background: thumb ? `center/cover no-repeat url("${thumb}")` : '#EDE7DB' }} />
              )
            })}
            {sample.length === 0 && <div style={{ gridColumn: '1 / -1', fontSize: 13, color: MUTED, textAlign: 'center', padding: 20 }}>{t('ad.addPhotosHint')}</div>}
          </div>
        </div>

        {/* Controls rail */}
        {/* borderLeft and maxWidth live in album.css now: stacked on a phone this pane is full
            width, where a left border is just a stray vertical line and a 420px cap does nothing. */}
        <div className="hush-designer-rail" style={{ flex: '1 1 340px', minWidth: 0, background: '#FFFFFF' }}>

          {/* Font */}
          <div style={section}>
            <p style={label}>{t('ot.font')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: 8 }}>
              {ALBUM_FONTS.map((f) => {
                const on = currentFont === f.key
                return (
                  <button key={f.key} type="button" onClick={() => setFont(f.key)} title={f.label} className="hush-press"
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '8px 2px', minHeight: 50, borderRadius: 10, background: '#FFFFFF', color: BRAND, border: on ? `2px solid ${BRAND}` : `1.5px solid ${BORDER}`, cursor: 'pointer' }}>
                    <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, fontFamily: f.stack }}>Aa</span>
                    <span style={{ fontSize: 9, fontWeight: 600, color: MUTED }}>{f.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Photo style */}
          <div style={section}>
            <p style={label}>{t('ad.photoStyle')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 8 }}>
              {ALBUM_PHOTO_STYLES.map((s) => {
                const on = currentStyle === s.key
                const r = photoStyleTile(s.key === 'default' ? null : s.key, 10).radius
                return (
                  <button key={s.key} type="button" onClick={() => setPhotoStyle(s.key)} title={s.label} className="hush-press"
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '9px 2px', borderRadius: 10, background: '#FFFFFF', border: on ? `2px solid ${BRAND}` : `1.5px solid ${BORDER}`, cursor: 'pointer' }}>
                    <span style={{ width: 26, height: 26, borderRadius: s.key === 'default' ? 8 : r, background: '#C9B79E', border: s.key === 'framed' ? '3px solid #FFF' : undefined, boxShadow: s.key === 'framed' ? '0 0 0 1px #DDD5C5' : undefined }} />
                    <span style={{ fontSize: 9, fontWeight: 600, color: MUTED, textAlign: 'center' }}>{s.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Colour */}
          <div style={section}>
            <p style={label}>{t('ot.albumColor')}</p>
            {/* One row by default — the full 24-colour grid was the tallest thing in the panel and
                pushed everything else below the fold. "More" reveals the rest. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(38px, 1fr))', gap: 6, marginBottom: 10 }}>
              {(showAllAccents ? ACCENT_PALETTE : ACCENT_PALETTE.slice(0, 7)).map((c) => {
                const on = currentAccent.toLowerCase() === c.toLowerCase()
                return (
                  <button key={c} type="button" onClick={() => setAccent(c)} title={c} className="hush-press"
                    style={{ aspectRatio: '1', borderRadius: 8, background: c, border: on ? `2px solid ${BRAND}` : `1.5px solid ${BORDER}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <span style={{ fontSize: 11, color: contrastText(c) }}>✓</span>}
                  </button>
                )
              })}
              {!showAllAccents && (
                <button type="button" onClick={() => setShowAllAccents(true)} title={t('ad.more')} className="hush-press"
                  style={{ aspectRatio: '1', borderRadius: 8, background: '#F5F0E8', border: `1.5px solid ${BORDER}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: BRAND, fontSize: 9, fontWeight: 700 }}>
                  {t('ad.more')}
                </button>
              )}
            </div>
            {/* Ungated while we get every design feature working end-to-end — pricing comes later. */}
            {(
              <>
                <button type="button" onClick={() => setShowAccentPicker((v) => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: BRAND, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 5, background: currentAccent, border: `1px solid ${BORDER}` }} />
                  {t('ot.customColor')}
                </button>
                {showAccentPicker && (
                  <div style={{ marginTop: 10 }}>
                    <HushColorPicker value={/^#[0-9a-f]{6}$/i.test(accentHex) ? accentHex : DEFAULT_ACCENT} onChange={onAccentHex} />
                  </div>
                )}
              </>
            )}
            <div style={{ display: 'flex', marginTop: 8 }}>
              <button type="button" onClick={() => setAccent(DEFAULT_ACCENT)} style={{ marginLeft: 'auto', fontSize: 12, color: MUTED, background: 'none', border: 'none', cursor: 'pointer' }}>{t('ot.reset')}</button>
            </div>
            {(album.cover_photo_id || album.header_image) && (
              <p style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>{t('ad.colourClearsPhoto')}</p>
            )}
          </div>

          {/* Logo */}
          <div style={section}>
            <p style={label}>{t('ad.logo')}</p>
            {/* Ungated while we get every design feature working end-to-end — pricing comes later. */}
            {(
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => logoFileInputRef.current?.click()}
                    disabled={uploadingLogo}
                    title={album.logo_url ? t('ad.replaceLogo') : t('ad.addPhoto')}
                    style={{
                      width: 64, height: 64, borderRadius: 10, flex: '0 0 auto', overflow: 'hidden',
                      background: album.logo_url ? '#FFFFFF' : '#F5F0E8',
                      border: album.logo_url ? `1.5px solid ${BORDER}` : `1.5px dashed ${BORDER}`,
                      cursor: uploadingLogo ? 'wait' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 6,
                    }}
                  >
                    {/* A real <img>, not a CSS backgroundImage. The button also sets the `background`
                        shorthand, which RESETS background-image — so on any re-render the two fought
                        each other and the thumbnail flickered. An element can't have that conflict. */}
                    {uploadingLogo ? (
                      <Loader2 className="w-4 h-4 animate-spin" style={{ color: BRAND }} />
                    ) : album.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={album.logo_url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
                    ) : (
                      <Plus className="w-5 h-5" style={{ color: BRAND }} />
                    )}
                  </button>
                  <input
                    ref={logoFileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void handleAddLogo(file)
                      e.target.value = ''
                    }}
                  />
                  {album.logo_url && (
                    <button type="button" onClick={() => setLogo(null)} className="hush-press" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: MUTED, background: 'none', border: `1.5px solid ${BORDER}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
                      <X className="w-3.5 h-3.5" /> {t('ad.none')}
                    </button>
                  )}
                </div>
                {logoUploadError && <p style={{ fontSize: 11, color: '#C0392B', marginTop: 8 }}>{logoUploadError}</p>}
              </>
            )}
          </div>

          {/* Sponsors */}
          <div style={section}>
            <p style={label}>{t('ad.sponsors')}</p>
            {/* Free for everyone — sponsor branding is a core need for the race/festival albums
                this is aimed at, so gating it behind a plan would block the exact users it exists
                for. Server-side gate removed to match (see /api/album/sponsors). */}
            {(
              <>
                <p style={{ fontSize: 11, color: MUTED, marginTop: -4, marginBottom: 8 }}>{t('ad.sponsorsHint')}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {album.sponsor_logos.map((s, i) => (
                    <div key={s.id} style={{ position: 'relative', width: 64 }}>
                      <div style={{
                        width: 64, height: 64, borderRadius: 10, background: '#FFFFFF', border: `1.5px solid ${BORDER}`,
                        backgroundImage: `url("${s.url}")`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center',
                      }} />
                      <button type="button" onClick={() => removeSponsor(s.id)} title={t('ad.none')}
                        style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: BRAND, color: '#FDFAF5', border: '2px solid #FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <X className="w-3 h-3" />
                      </button>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 2, marginTop: 3 }}>
                        <button type="button" onClick={() => moveSponsor(s.id, -1)} disabled={i === 0} title={t('ad.moveUp')}
                          style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? '#DDD5C5' : MUTED, padding: 0 }}>
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => moveSponsor(s.id, 1)} disabled={i === album.sponsor_logos.length - 1} title={t('ad.moveDown')}
                          style={{ background: 'none', border: 'none', cursor: i === album.sponsor_logos.length - 1 ? 'default' : 'pointer', color: i === album.sponsor_logos.length - 1 ? '#DDD5C5' : MUTED, padding: 0 }}>
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {album.sponsor_logos.length < MAX_SPONSORS && (
                    <button
                      type="button"
                      onClick={() => sponsorFileInputRef.current?.click()}
                      disabled={uploadingSponsor}
                      title={t('ad.addPhoto')}
                      style={{ width: 64, height: 64, borderRadius: 10, background: '#F5F0E8', border: `1.5px dashed ${BORDER}`, cursor: uploadingSponsor ? 'wait' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: BRAND }}
                    >
                      {uploadingSponsor ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                        <>
                          <Plus className="w-4 h-4" />
                          <span style={{ fontSize: 9, fontWeight: 600 }}>{t('ad.addPhoto')}</span>
                        </>
                      )}
                    </button>
                  )}
                  <input
                    ref={sponsorFileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void handleAddSponsor(file)
                      e.target.value = ''
                    }}
                  />
                </div>
                {sponsorError && <p style={{ fontSize: 11, color: '#C0392B', marginTop: 8 }}>{sponsorError}</p>}
              </>
            )}
          </div>

          {/* Welcome */}
          <div style={section}>
            <p style={label}>{t('ot.welcomeMessage')}</p>
            <input defaultValue={album.welcome_message ?? ''} maxLength={200} placeholder={t('ot.welcomePlaceholder')}
              onBlur={(e) => setWelcome(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              style={{ width: '100%', padding: '9px 12px', fontSize: 14, borderRadius: 8, border: `1px solid ${BORDER}`, background: '#FDFAF5', color: INK }} />
          </div>

          {/* Header photo */}
          <div style={section}>
            <p style={label}>{t('ad.headerPhoto')}</p>
            {cover && (
              <>
                <p style={{ fontSize: 11, color: MUTED, marginTop: -4, marginBottom: 8 }}>{t('ad.dragToPosition')}</p>
                {/* Zoom + drag together are the whole crop control: zoom decides how much of the
                    photo is shown, dragging the preview decides which part. Two inputs, no modal. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: MUTED, flex: '0 0 auto' }}>{t('ad.zoom')}</span>
                  <input
                    type="range" min={100} max={300} step={5} value={album.header_zoom ?? 100}
                    onChange={(e) => onHeaderZoom(Number(e.target.value))}
                    style={{ flex: 1, minWidth: 0, accentColor: BRAND, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 11, color: MUTED, width: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {album.header_zoom ?? 100}%
                  </span>
                </div>
              </>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: 6, maxHeight: 264, overflowY: 'auto', paddingRight: 2 }}>
              <button type="button" onClick={() => setCover(null)} title={t('ad.none')}
                style={{ aspectRatio: '1', borderRadius: 8, background: '#F5F0E8', border: (!album.cover_photo_id && !album.header_image) ? `2px solid ${BRAND}` : `1.5px solid ${BORDER}`, cursor: 'pointer', fontSize: 9, color: MUTED }}>{t('ad.none')}</button>
              <button
                type="button"
                onClick={() => headerFileInputRef.current?.click()}
                disabled={uploadingHeader}
                title={t('ad.addPhoto')}
                style={{ aspectRatio: '1', borderRadius: 8, background: '#F5F0E8', border: album.header_image ? `2px solid ${BRAND}` : `1.5px dashed ${BORDER}`, cursor: uploadingHeader ? 'wait' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: BRAND, backgroundImage: album.header_image ? `url("${album.header_image}")` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}
              >
                {uploadingHeader ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : !album.header_image ? (
                  <>
                    <Plus className="w-4 h-4" />
                    <span style={{ fontSize: 9, fontWeight: 600 }}>{t('ad.addPhoto')}</span>
                  </>
                ) : null}
              </button>
              <input
                ref={headerFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleAddHeaderPhoto(file)
                  e.target.value = ''
                }}
              />
              {/* Every photo is a candidate, not just the first page-load's worth — capped only as
                  a hard safety limit for extreme-sized albums, scrollable within its own box so it
                  can't push the rest of the panel off-screen. */}
              {photos.slice(0, HEADER_PICKER_MAX).map((p) => {
                const thumb = p.media_type === 'video' ? (p.poster_url || p.stream_thumbnail_url || p.thumb_url || '') : (p.thumb_url || p.url || '')
                const on = album.cover_photo_id === p.id
                return (
                  <button key={p.id} type="button" onClick={() => setCover(p.id)} title={p.media_type === 'video' ? t('ad.video') : undefined}
                    style={{ aspectRatio: '1', borderRadius: 8, border: on ? `2px solid ${BRAND}` : `1.5px solid ${BORDER}`, cursor: 'pointer', background: thumb ? `center/cover no-repeat url("${thumb}")` : '#EDE7DB', position: 'relative' }}>
                    {p.media_type === 'video' && (
                      <Play className="w-3.5 h-3.5" style={{ position: 'absolute', top: 4, right: 4, color: '#FDFAF5', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }} fill="#FDFAF5" />
                    )}
                  </button>
                )
              })}
            </div>
            {photos.length > HEADER_PICKER_MAX && (
              <p style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>{t('ad.headerPickerCapped', { n: HEADER_PICKER_MAX })}</p>
            )}
            {headerUploadError && <p style={{ fontSize: 11, color: '#C0392B', marginTop: 8 }}>{headerUploadError}</p>}

            {/* Playback mode — only meaningful when the chosen header is a video. */}
            {headerVideo && (
              <div style={{ marginTop: 14 }}>
                <p style={{ ...label, marginBottom: 6 }}>{t('ad.videoPlayback')}</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                  {HEADER_VIDEO_MODES.map((m) => {
                    const on = (album.header_video_mode ?? 'loop') === m.key
                    return (
                      <button key={m.key} type="button" onClick={() => setHeaderVideoMode(m.key)} className="hush-press"
                        style={{ padding: '7px 6px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: on ? BRAND : '#FFFFFF', color: on ? '#FDFAF5' : BRAND, border: on ? `2px solid ${BRAND}` : `1.5px solid ${BORDER}`, cursor: 'pointer' }}>
                        {t(`ad.videoMode.${m.key}`)}
                      </button>
                    )
                  })}
                </div>
                <p style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>{t('ad.videoHoverNote')}</p>
              </div>
            )}
          </div>

          {/* Background */}
          <div style={{ ...section, borderBottom: 'none' }}>
            <p style={label}>{t('ad.background')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(38px, 1fr))', gap: 6, marginBottom: 10 }}>
              {PRESETS.map((preset) => (
                <button key={preset.value} type="button" title={preset.label} onClick={() => setBackground(preset.value)}
                  style={{ aspectRatio: '1', borderRadius: 8, background: preset.value, border: bgTheme === preset.value ? `2px solid ${BRAND}` : `1.5px solid ${BORDER}`, cursor: 'pointer' }} />
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <button type="button" onClick={() => setShowBgPicker((v) => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: BRAND, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600 }}>
                <span style={{ width: 18, height: 18, borderRadius: 5, background: bgColorHex, border: `1px solid ${BORDER}` }} />
                {t('ot.customColor')}
              </button>
              <button type="button" onClick={() => setBackground(null)} style={{ marginLeft: 'auto', fontSize: 12, color: MUTED, background: 'none', border: 'none', cursor: 'pointer' }}>{t('ot.reset')}</button>
            </div>
            {showBgPicker && (
              <div style={{ marginBottom: 12 }}>
                <HushColorPicker value={/^#[0-9a-f]{6}$/i.test(bgColorHex) ? bgColorHex : DEFAULT_BG} onChange={onBackgroundHex} />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: 6, maxHeight: 264, overflowY: 'auto', paddingRight: 2 }}>
              <button
                type="button"
                onClick={() => bgFileInputRef.current?.click()}
                disabled={uploadingBg}
                title={t('ad.addPhoto')}
                style={{ aspectRatio: '1', borderRadius: 8, background: '#F5F0E8', border: `1.5px dashed ${BORDER}`, cursor: uploadingBg ? 'wait' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: BRAND }}
              >
                {uploadingBg ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span style={{ fontSize: 9, fontWeight: 600 }}>{t('ad.addPhoto')}</span>
                  </>
                )}
              </button>
              <input
                ref={bgFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleAddBackground(file)
                  e.target.value = ''
                }}
              />
              {STOCK_ALBUM_BACKGROUNDS.map((preset) => {
                const on = bgTheme === preset.value || bgTheme === preset.legacyValue || bgTheme === preset.imageValue
                return (
                  <button key={preset.value} type="button" title={preset.label} onClick={() => setBackground(preset.value)}
                    style={{ aspectRatio: '1', borderRadius: 8, border: on ? `2px solid ${BRAND}` : `1.5px solid ${BORDER}`, cursor: 'pointer', background: `center/cover no-repeat url("${preset.src}")` }} />
                )
              })}
            </div>
            {bgUploadError && <p style={{ fontSize: 11, color: '#C0392B', marginTop: 8 }}>{bgUploadError}</p>}
          </div>

        </div>
      </div>
    </div>
  )
}
