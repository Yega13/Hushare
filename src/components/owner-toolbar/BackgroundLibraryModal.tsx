'use client'

import { Check, X } from 'lucide-react'
import { STOCK_ALBUM_BACKGROUNDS } from '@/lib/album-backgrounds'
import { useT } from '@/i18n/LocaleProvider'

type Props = {
  backgroundSaving: boolean
  bgChoice: string
  onChoose: (choice: string, closeLibrary?: boolean) => void
  onClose: () => void
}

export default function BackgroundLibraryModal({ backgroundSaving, bgChoice, onChoose, onClose }: Props) {
  const { t } = useT()
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6"
      style={{ background: 'rgba(26, 43, 26, 0.46)', backdropFilter: 'blur(8px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="hush-modal-pop max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-2xl shadow-2xl"
        style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-5 py-4"
          style={{ background: '#FFFFFF', borderBottom: '1px solid #E8E0D2' }}
        >
          <div>
            <h2 className="text-base font-semibold" style={{ color: '#630826' }}>{t('blm.title')}</h2>
            <p className="text-xs" style={{ color: '#7C5C3E' }}>{t('blm.subtitle')}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 transition hover:opacity-80"
            style={{ color: '#7C5C3E', background: '#F5F0E8', cursor: 'pointer' }}
            aria-label={t('blm.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
          {STOCK_ALBUM_BACKGROUNDS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              disabled={backgroundSaving}
              onClick={() => onChoose(preset.value, true)}
              className="hush-hover-lift group overflow-hidden rounded-xl text-left transition hover:opacity-95 disabled:cursor-wait"
              style={{
                border: (bgChoice === preset.value || bgChoice === preset.legacyValue || bgChoice === preset.imageValue) ? '2px solid #630826' : '1px solid #DDD5C5',
                background: '#FDFAF5',
                cursor: backgroundSaving ? 'wait' : 'pointer',
              }}
            >
              <span
                className="relative block aspect-[4/3] w-full"
                style={{
                  backgroundImage: `url(${preset.src})`,
                  backgroundPosition: 'center',
                  backgroundSize: 'cover',
                }}
              >
                {(bgChoice === preset.value || bgChoice === preset.legacyValue || bgChoice === preset.imageValue) && (
                  <span
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ background: 'rgba(99,8,38,0.28)', color: '#FFFFFF' }}
                  >
                    <Check className="h-6 w-6" />
                  </span>
                )}
              </span>
              <span className="block px-3 py-2 text-xs font-semibold" style={{ color: '#630826' }}>
                {preset.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
