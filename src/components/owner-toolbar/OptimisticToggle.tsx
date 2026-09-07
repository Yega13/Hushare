'use client'

import type { ReactNode } from 'react'
import type { Album } from '@/types'
import { showAppToast } from '@/components/AppToast'
import { useT } from '@/i18n/LocaleProvider'

// ONE SWITCH, ONE RULE: flip it now, tell the server, put it back if the server says no.
//
// Six owner switches carried this pattern inline, each with its own copy of the optimistic set, the
// request, the revert-on-failure and the network-error toast -- and each also mirrored the album
// field into a local useState that a resync effect had to keep honest. None of that is needed:
// the parent's album state IS the optimistic store (onAlbumUpdated re-renders synchronously), so
// `checked` reads the album and both the flip and the revert go through the same patch.

type Props<K extends keyof Album> = {
  album: Album
  field: K
  /** How the stored value reads as a boolean -- most are `!!v`, two default to on when null. */
  checked: (value: Album[K]) => boolean
  save: (slug: string, next: boolean) => Promise<{ ok: true } | { ok: false; error: string }>
  onAlbumUpdated: (patch: Partial<Album>) => void
  disabled?: boolean
  /** Row chrome: label, sub-label, and the gated style are the caller's. */
  label: ReactNode
  sub: ReactNode
  rowStyle?: React.CSSProperties
  className?: string
  labelClassName?: string
}

export default function OptimisticToggle<K extends keyof Album>({ album, field, checked, save, onAlbumUpdated, disabled, label, sub, rowStyle, className, labelClassName }: Props<K>) {
  const { t } = useT()
  const value = checked(album[field])

  async function flip(next: boolean) {
    onAlbumUpdated({ [field]: next } as Partial<Album>)
    try {
      const result = await save(album.slug, next)
      if (!result.ok) {
        showAppToast(result.error, 'error')
        onAlbumUpdated({ [field]: !next } as Partial<Album>)
      }
    } catch (e) {
      showAppToast(e instanceof Error ? e.message : t('common.networkError'), 'error')
      onAlbumUpdated({ [field]: !next } as Partial<Album>)
    }
  }

  return (
    <label className={className ?? 'flex items-center justify-between gap-4 rounded-xl px-3 py-3'} style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', cursor: 'pointer', ...rowStyle }}>
      <span>
        <span className={labelClassName ?? 'block text-sm font-semibold'} style={{ color: '#630826' }}>{label}</span>
        <span className="block text-xs" style={{ color: '#7C5C3E' }}>{sub}</span>
      </span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => void flip(e.target.checked)}
        className="h-4 w-4"
        disabled={disabled}
      />
    </label>
  )
}
