import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MEDIA_DISPLAY_FILTER_OPTIONS } from '@/lib/media-display'
import type { PhotoFilterChoice } from '@/lib/media-display'
import type { Album, Photo } from '@/types'

type Props = {
  album: Album
  photo: Photo
  radius: number
  filter: PhotoFilterChoice
  caption: string
  author: string
  radiusMax: number
  captionMax: number
  authorMax: number
  onClose: () => void
  onRadiusChange: (value: number) => void
  onRadiusReset: () => void
  onFilterChange: (value: PhotoFilterChoice) => void
  onCaptionChange: (value: string) => void
  onAuthorChange: (value: string) => void
}

export default function PhotoSettingsModal({
  album,
  photo,
  radius,
  filter,
  caption,
  author,
  radiusMax,
  captionMax,
  authorMax,
  onClose,
  onRadiusChange,
  onRadiusReset,
  onFilterChange,
  onCaptionChange,
  onAuthorChange,
}: Props) {
  const [radiusDraft, setRadiusDraft] = useState(String(radius))
  const [radiusEditing, setRadiusEditing] = useState(false)

  useEffect(() => {
    if (!radiusEditing) setRadiusDraft(String(radius))
  }, [radius, radiusEditing])

  function parseRadiusDraft(value: string): number | null {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) return null
    return Math.max(0, Math.min(radiusMax, Math.round(parsed)))
  }

  function commitRadiusDraft() {
    const next = parseRadiusDraft(radiusDraft)
    if (next == null) {
      setRadiusDraft(String(radius))
      return
    }
    onRadiusChange(next)
    setRadiusDraft(String(next))
  }

  function changeRadiusDraft(value: string) {
    const digitsOnly = value.replace(/[^\d]/g, '')
    setRadiusDraft(digitsOnly)
    const next = parseRadiusDraft(digitsOnly)
    if (next != null) onRadiusChange(next)
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-6"
      data-scroll-allowed="true"
      style={{ background: 'rgba(26, 43, 26, 0.42)', backdropFilter: 'blur(8px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="hush-modal-pop w-full max-w-sm rounded-2xl shadow-2xl" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
        <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: '1px solid #E8E0D2' }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: '#630826' }}>Media settings</h2>
            <p className="text-xs" style={{ color: '#7C5C3E' }}>{caption || author || photo.caption || 'Only this item.'}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 transition hover:opacity-80" style={{ color: '#7C5C3E', background: '#F5F0E8' }} aria-label="Close media settings">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="space-y-3">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="text-xs font-medium" style={{ color: '#7C5C3E' }}>Description</label>
                <span className="text-xs font-mono" style={{ color: '#A89880' }}>{caption.length}/{captionMax}</span>
              </div>
              <input
                type="text"
                value={caption}
                maxLength={captionMax}
                onChange={(e) => onCaptionChange(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#630826' }}
                placeholder="Photo description"
              />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="text-xs font-medium" style={{ color: '#7C5C3E' }}>Author name</label>
                <span className="text-xs font-mono" style={{ color: '#A89880' }}>{author.length}/{authorMax}</span>
              </div>
              <input
                type="text"
                value={author}
                maxLength={authorMax}
                onChange={(e) => onAuthorChange(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#630826' }}
                placeholder="Author name"
              />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="text-xs font-medium" style={{ color: '#7C5C3E' }}>Corner radius</label>
              <span className="text-xs font-mono" style={{ color: '#A89880' }}>{radius}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={radiusMax}
              value={radius}
              onChange={(e) => onRadiusChange(Number(e.target.value))}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              className="w-full"
            />
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={radiusDraft}
              onChange={(e) => changeRadiusDraft(e.target.value)}
              onFocus={() => {
                setRadiusEditing(true)
                setRadiusDraft(String(radius))
              }}
              onBlur={() => {
                setRadiusEditing(false)
                commitRadiusDraft()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  setRadiusDraft(String(radius))
                  e.currentTarget.blur()
                }
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              className="mt-2 w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#630826' }}
            />
            <button
              type="button"
              onClick={() => {
                setRadiusEditing(false)
                setRadiusDraft(String(album.media_radius ?? 12))
                onRadiusReset()
              }}
              className="mt-2 text-xs"
              style={{ color: '#A89880' }}
            >
              Use global radius
            </button>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium" style={{ color: '#7C5C3E' }}>Filter</label>
            <select
              value={filter}
              onChange={(e) => onFilterChange(e.target.value as PhotoFilterChoice)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#630826' }}
            >
              <option value="global">Use global ({MEDIA_DISPLAY_FILTER_OPTIONS.find((option) => option.value === (album.media_filter ?? 'none'))?.label ?? 'None'})</option>
              {MEDIA_DISPLAY_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <p className="text-xs text-center" style={{ color: '#A89880' }}>Changes are saved when you close.</p>
        </div>
      </div>
    </div>
  )
}
