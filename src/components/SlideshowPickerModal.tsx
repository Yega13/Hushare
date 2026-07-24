'use client'

import { Check, Play, X } from 'lucide-react'
import type { Photo } from '@/types'
import { useT } from '@/i18n/LocaleProvider'

type Props = {
  photos: Photo[]
  selectedIds: Set<string>
  onClose: () => void
  onSelectAll: () => void
  onClearAll: () => void
  onToggle: (id: string) => void
  onCreate: () => void
}

export default function SlideshowPickerModal({
  photos,
  selectedIds,
  onClose,
  onSelectAll,
  onClearAll,
  onToggle,
  onCreate,
}: Props) {
  const { t } = useT()
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-6"
      onClick={onClose}
    >
      <div aria-hidden className="absolute inset-0" style={{ background: 'rgba(12, 16, 12, 0.72)' }} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="slideshow-picker-title"
        className="relative z-10 w-[min(94vw,860px)] rounded-2xl p-4 sm:p-5"
        style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', boxShadow: '0 24px 70px rgba(0,0,0,0.28)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2
              id="slideshow-picker-title"
              className="text-lg font-semibold"
              style={{ color: '#630826', fontFamily: 'var(--font-serif)' }}
            >
              {t('ot.createSlideshow')}
            </h2>
            <p className="text-sm mt-1" style={{ color: '#7C5C3E' }}>
              {t('ss.pickMedia')}
            </p>
          </div>
          <button
            type="button"
            className="rounded-full p-2 transition hover:opacity-80"
            style={{ background: '#F5F0E8', color: '#7C5C3E' }}
            onClick={onClose}
            aria-label={t('ss.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-full px-3 py-1.5 text-sm font-semibold transition hover:opacity-80"
            style={{ background: '#F6E9EE', color: '#630826' }}
            onClick={onSelectAll}
          >
            {t('ss.selectAll')}
          </button>
          <button
            type="button"
            className="rounded-full px-3 py-1.5 text-sm font-semibold transition hover:opacity-80"
            style={{ background: '#F5F0E8', color: '#7C5C3E' }}
            onClick={onClearAll}
          >
            {t('ot.clear')}
          </button>
          <span className="text-sm" style={{ color: '#8B6F4E' }}>{t('ss.selected', { n: selectedIds.size })}</span>
        </div>

        <div
          className="grid max-h-[52vh] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 md:grid-cols-5"
          data-scroll-allowed="true"
        >
          {photos.map((photo) => {
            const selected = selectedIds.has(photo.id)
            const thumbSrc =
              photo.media_type === 'video'
                ? photo.stream_thumbnail_url || photo.poster_url || ''
                : photo.thumb_url || photo.url
            return (
              <button
                key={photo.id}
                type="button"
                className="relative aspect-square overflow-hidden rounded-xl transition"
                style={{
                  border: selected ? '3px solid #630826' : '1px solid #DDD5C5',
                  background: '#E8E0D2',
                }}
                onClick={() => onToggle(photo.id)}
              >
                {thumbSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbSrc} alt="" className="h-full w-full object-cover" draggable={false} />
                ) : (
                  <span className="flex h-full w-full items-center justify-center" style={{ color: '#7C5C3E' }}>
                    <Play className="h-7 w-7" />
                  </span>
                )}
                {photo.media_type === 'video' && thumbSrc && (
                  <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span
                      className="rounded-full flex items-center justify-center"
                      style={{ width: 28, height: 28, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
                    >
                      <Play className="h-3.5 w-3.5" style={{ color: '#FDFAF5', marginLeft: 1 }} fill="#FDFAF5" />
                    </span>
                  </span>
                )}
                <span
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full"
                  style={{
                    background: selected ? '#630826' : 'rgba(253,250,245,0.82)',
                    color: selected ? '#FDFAF5' : '#7C5C3E',
                    border: '1px solid rgba(99,8,38,0.18)',
                  }}
                >
                  {selected ? <Check className="h-4 w-4" /> : null}
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="rounded-xl px-4 py-2 font-semibold transition hover:opacity-80"
            style={{ background: '#F5F0E8', color: '#7C5C3E' }}
            onClick={onClose}
          >
            {t('ot.cancel')}
          </button>
          <button
            type="button"
            className="rounded-xl px-4 py-2 font-semibold transition hover:opacity-90"
            style={{ background: '#630826', color: '#FDFAF5' }}
            onClick={onCreate}
          >
            {t('ot.createSlideshow')}
          </button>
        </div>
      </section>
    </div>
  )
}
