'use client'

import { useState } from 'react'
import { showAppToast } from '@/components/AppToast'
import { useT } from '@/i18n/LocaleProvider'
import type { Photo } from '@/types'

// PHOTOS A GUEST ADDED THAT NOBODY HAS SEEN YET.
//
// They used to sit inline in the album with a small "hidden" badge, and the only way to publish
// one was: tap it, open its settings, find the toggle, flip it, close. Six taps, on a photo you
// first had to FIND among four and a half thousand others. So a real queue built up on a live
// event album while its owner had no idea it existed — and every photo in it was invisible to the
// bib and face search, meaning a runner searching for a photo sitting in that queue was told
// there was nothing.
//
// A queue you have to hunt for is a queue nobody works. This is a strip of its own, above the
// album, on its own tinted ground, with a count. One tap per decision.
//
// Owner-only by construction: the parent renders it only for an owner, and a guest's photo list
// never contains hidden rows at all (see fetchAuthorizedPhotos).

type Props = {
  slug: string
  photos: Photo[]                        // hidden rows only — the parent filters
  onAccepted: (ids: string[]) => void
  onDeclined: (ids: string[]) => void
}

export default function PendingReview({ slug, photos, onAccepted, onDeclined }: Props) {
  const { t } = useT()
  // Which single tile is asking "sure?", and whether the bulk decline is. Two-step, the same
  // shape as deleting an album from the account page — declining destroys the file, and there is
  // no backup of storage, so one stray tap must not be enough (rule 19).
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (photos.length === 0) return null

  async function accept(ids: string[]) {
    if (busy) return
    setBusy(true)
    try {
      // No bulk endpoint for this, so one request each — bounded by how many a guest can upload
      // between reviews, and run in parallel so twenty is one round trip's wait, not twenty.
      const results = await Promise.all(ids.map(async (id) => {
        try {
          const res = await fetch('/api/album/photo/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug, photo_id: id, hidden: false }),
          })
          return res.ok ? id : null
        } catch { return null }
      }))
      const ok = results.filter((id): id is string => id !== null)
      // Only what actually succeeded leaves the queue. Removing all of them on a partial failure
      // would hide photos that are still unpublished, with nothing left to publish them from.
      if (ok.length > 0) onAccepted(ok)
      if (ok.length < ids.length) showAppToast(t('review.failed'), 'error')
      else showAppToast(t('review.accepted'))
    } finally {
      setBusy(false)
      setConfirmingId(null)
    }
  }

  async function decline(ids: string[]) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/album/photo/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, photo_ids: ids }),
      })
      if (!res.ok) {
        showAppToast(t('review.failed'), 'error')
        return
      }
      onDeclined(ids)
      showAppToast(t('review.declined'))
    } catch {
      showAppToast(t('review.failed'), 'error')
    } finally {
      setBusy(false)
      setConfirmingId(null)
    }
  }

  return (
    <div className="hush-container pb-4">
      <section
        aria-label={t('review.title')}
        style={{ background: '#FFF6E9', border: '1px solid #E8CFA6', borderRadius: 16, padding: '14px 16px' }}
      >
        <div className="mb-3">
          <div>
            <h2 style={{ fontFamily: 'var(--font-serif)', color: '#7C4A2D', fontSize: 17, fontWeight: 700, margin: 0 }}>
              {t('review.title')} · {photos.length}
            </h2>
            <p style={{ color: '#96703F', fontSize: 12.5, margin: '2px 0 0' }}>{t('review.sub')}</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: 10 }}>
          {photos.map((photo) => (
            <div key={photo.id} style={{ background: '#FFFDF8', border: '1px solid #E8CFA6', borderRadius: 12, overflow: 'hidden' }}>
              {/* No toolbar. Download, favourite, settings and delete are all meaningless for a
                  photo that is not in the album yet — there is exactly one decision to make. */}
              {photo.thumb_url || photo.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.thumb_url || photo.url || ''}
                  alt=""
                  loading="lazy"
                  style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div style={{ width: '100%', aspectRatio: '1', background: '#F2E6D2' }} />
              )}
              <div className="flex gap-1.5 p-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void accept([photo.id])}
                  aria-label={t('review.accept')}
                  className="hush-press flex-1 rounded-lg py-2 font-bold disabled:opacity-50"
                  style={{ background: '#1F5136', color: '#FDFAF5', border: 'none', fontSize: 11, whiteSpace: 'nowrap' }}
                >
                  {t('review.accept')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => (confirmingId === photo.id ? void decline([photo.id]) : setConfirmingId(photo.id))}
                  onBlur={() => setConfirmingId((cur) => (cur === photo.id ? null : cur))}
                  aria-label={t('review.decline')}
                  className="hush-press flex-1 rounded-lg py-2 font-bold disabled:opacity-50"
                  style={{
                    background: confirmingId === photo.id ? '#C0392B' : '#FDFAF5',
                    color: confirmingId === photo.id ? '#FDFAF5' : '#C0392B',
                    border: '1px solid #C0392B',
                    fontSize: 11,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {confirmingId === photo.id ? t('review.declineSure') : t('review.decline')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
