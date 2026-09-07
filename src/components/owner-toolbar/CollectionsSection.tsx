'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, FolderPlus } from 'lucide-react'
import type { Album, Tier } from '@/types'
import { FEATURE_TIER } from '@/lib/plan-gates'
import type { RowLook } from '@/lib/owner-rows'
import { showAppToast } from '@/components/AppToast'
import { addAlbumToCollectionRequest, fetchCollections } from '@/components/owner-toolbar/api'
import { accordionButton, sectionTitle, settingsSectionStyle } from '@/components/owner-toolbar/styles'
import type { CollectionSummary } from '@/components/owner-toolbar/types'
import PlanBadge from '@/components/PlanBadge'
import { useT } from '@/i18n/LocaleProvider'

// THE COLLECTIONS PANEL: add this album to one of the account's collections (/c/<slug>). Collections
// are the one ACCOUNT-scoped feature, so `row` comes from the account-level answer the server sent,
// not the album's tier -- lib/owner-rows explains why.
//
// The list loads when this mounts, which is when Settings opens (the panels render only then), so
// it is ready before the accordion is expanded -- the same moment the toolbar used to load it.
// `loading` starts as the answer rather than being set inside the effect, so the effect writes
// state only after its await.

type Props = {
  album: Album
  userTier: Tier | null
  row: RowLook
  open: boolean
  onToggle: () => void
}

export default function CollectionsSection({ album, userTier, row, open, onToggle }: Props) {
  const { t } = useT()
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [loading, setLoading] = useState(row.enabled)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [addedUrl, setAddedUrl] = useState('')

  useEffect(() => {
    if (!row.enabled) return
    let cancelled = false
    fetchCollections(album.slug)
      .then((list) => { if (!cancelled) setCollections(list) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [album.slug, row.enabled])

  async function addTo(collectionId: string) {
    setSaving(true)
    setError('')
    setAddedUrl('')
    try {
      const result = await addAlbumToCollectionRequest(album.slug, collectionId)
      if (!result.ok) {
        setError(result.error)
        showAppToast(result.error, 'error')
        return
      }
      setAddedUrl(`${window.location.origin}/c/${result.slug}`)
      setCollections(await fetchCollections(album.slug))
      showAppToast(t('ot.addedToCollection'))
    } catch (e) {
      const message = e instanceof Error ? e.message : t('common.networkError')
      setError(message)
      showAppToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section style={settingsSectionStyle}>
      <button type="button" className="hush-motion" style={accordionButton} onClick={onToggle}>
        <FolderPlus className="w-4 h-4" style={{ color: row.dimmed ? '#A89880' : '#7C5C3E' }} />
        <span style={sectionTitle}>{t('ot.collections')}</span>
        <PlanBadge need={FEATURE_TIER.collections} tier={userTier} />
        <ChevronDown
          className="ml-auto w-4 h-4 transition-transform"
          style={{ color: '#A89880', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      {open && (
        <div className="px-4 pb-4">
          <p className="text-xs mb-3" style={{ color: '#7C5C3E' }}>
            {t('ot.collectionsSub')}
          </p>

          {row.enabled && (
            <div className="mb-4 rounded-xl p-3" style={{ background: '#FDFAF5', border: '1px solid #E8E0D2' }}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: '#8B6F4E' }}>{t('ot.yourCollections')}</span>
                {loading && <span className="text-xs" style={{ color: '#A89880' }}>{t('ot.loading')}</span>}
              </div>
              <div className="space-y-2">
                {collections.map((collection) => (
                  <button
                    key={collection.id}
                    type="button"
                    onClick={() => void addTo(collection.id)}
                    disabled={saving || collection.contains_album}
                    className="hush-press flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                    style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#630826' }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{collection.name}</span>
                      <span className="block truncate" style={{ color: '#8B6F4E' }}>
                        /c/{collection.slug} - {collection.album_count} album{collection.album_count === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold" style={{ color: collection.contains_album ? '#630826' : '#7C5C3E' }}>
                      {collection.contains_album ? t('ot.added') : t('ot.add')}
                    </span>
                  </button>
                ))}
                {!loading && collections.length === 0 && (
                  <p className="text-xs" style={{ color: '#8B6F4E' }}>{t('ot.noCollections')}</p>
                )}
              </div>
            </div>
          )}

          {error && <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{error}</p>}
          {addedUrl && (
            <p className="text-xs mt-2 break-all" style={{ color: '#630826' }}>
              Added: <a href={addedUrl} className="underline">{addedUrl}</a>
            </p>
          )}
        </div>
      )}
    </section>
  )
}
