'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Download, Loader2, ScanFace, Search } from 'lucide-react'
import type { Album, Photo, Tier } from '@/types'
import { FEATURE_TIER } from '@/lib/plan-gates'
import type { OwnerRows } from '@/lib/owner-rows'
import { showAppToast } from '@/components/AppToast'
import { saveBibSearchRequest, saveBrandingRequest, saveFaceFinderRequest } from '@/components/owner-toolbar/api'
import FaceConsentDialog from '@/components/owner-toolbar/FaceConsentDialog'
import OptimisticToggle from '@/components/owner-toolbar/OptimisticToggle'
import { accordionButton, sectionTitle, settingsSectionStyle } from '@/components/owner-toolbar/styles'
import PlanBadge, { gatedRowStyle } from '@/components/PlanBadge'
import { useT } from '@/i18n/LocaleProvider'

// THE FILES PANEL: download everything, and the three switches that shape what is done with the
// files -- branding, face finder, bib search. The switches read the album and write back through
// onAlbumUpdated; the face switch is the one that asks for consent before enabling (see
// FaceConsentDialog), so it is the one that is not an OptimisticToggle.

/** The zip download's state, owned by the toolbar so it survives Settings closing (see there). */
export type ZipDownload = { zipping: boolean; zipProgress: number; zipStatus: string; downloadZip: () => void }

type Props = {
  album: Album
  photos: Photo[]
  albumPhotoCount?: number
  zip: ZipDownload
  userTier: Tier | null
  rows: Pick<OwnerRows, 'branding' | 'faceFinder' | 'bibSearch'>
  open: boolean
  onToggle: () => void
  onAlbumUpdated: (patch: Partial<Album>) => void
}

export default function FilesSection({ album, photos, albumPhotoCount, zip, userTier, rows, open, onToggle, onAlbumUpdated }: Props) {
  const { t } = useT()
  const { zipping, zipProgress, zipStatus, downloadZip } = zip
  const [faceConsentOpen, setFaceConsentOpen] = useState(false)

  async function applyFaceFinder(next: boolean) {
    onAlbumUpdated({ face_finder_enabled: next })
    try {
      const result = await saveFaceFinderRequest(album.slug, next)
      if (!result.ok) throw new Error(result.error)
    } catch (err) {
      showAppToast(err instanceof Error ? err.message : t('common.networkError'), 'error')
      onAlbumUpdated({ face_finder_enabled: !next })
    }
  }

  return (
    <>
      <section style={settingsSectionStyle}>
        <button type="button" className="hush-motion" style={accordionButton} onClick={onToggle}>
          <Download className="w-4 h-4" style={{ color: '#7C5C3E' }} />
          <span style={sectionTitle}>{t('ot.files')}</span>
          <ChevronDown
            className="ml-auto w-4 h-4 transition-transform"
            style={{ color: '#A89880', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>
        {open && (
          <div className="px-4 pb-4 space-y-3">
            <button
              className="w-full flex items-center justify-center gap-2 font-semibold rounded-xl py-3 text-sm transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#630826', color: '#FDFAF5' }}
              disabled={zipping || photos.length === 0}
              onClick={downloadZip}
            >
              {zipping ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {zipStatus ? `${zipStatus} · ${zipProgress}%` : (zipProgress < 100 ? t('ot.downloading', { n: zipProgress }) : t('ot.creatingZip'))}
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  {t('ot.downloadAll', { n: Math.max(albumPhotoCount ?? 0, photos.length) })}
                </>
              )}
            </button>

            {/* Pro+. The server is the authority — this only decides what the owner is shown, and a
                free owner toggling it gets the plan message back rather than a silent failure. A
                COLLABORATION ALBUM shows it fixed instead of letting the owner flip a switch that
                snaps back: a control that undoes itself reads as a bug, and this owner is a partner. */}
            <OptimisticToggle
              album={album}
              field="hide_branding"
              checked={(v) => !!v}
              save={saveBrandingRequest}
              onAlbumUpdated={onAlbumUpdated}
              disabled={!rows.branding.enabled}
              rowStyle={gatedRowStyle(rows.branding.dimmed, !rows.branding.show)}
              labelClassName="flex items-center gap-2 text-sm font-semibold"
              label={<>Remove Hushare branding <PlanBadge need={FEATURE_TIER.hideBranding} tier={userTier} /></>}
              sub={album.branding_locked
                ? 'Kept on for this album as part of our collaboration.'
                : 'Hides our logo from this album’s header. Pro and Max.'}
            />

            <label
              className="flex items-center justify-between gap-4 rounded-xl px-3 py-3"
              style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', ...gatedRowStyle(rows.faceFinder.dimmed, !rows.faceFinder.show) }}
            >
              <span>
                <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#630826' }}>
                  <ScanFace className="w-4 h-4" />
                  {t('ot.faceFinder')}
                  <PlanBadge need={FEATURE_TIER.faceFinder} tier={userTier} />
                </span>
                <span className="block text-xs" style={{ color: '#7C5C3E' }}>{t('ot.faceFinderSub')}</span>
              </span>
              <input
                type="checkbox"
                checked={!!album.face_finder_enabled}
                disabled={!rows.faceFinder.enabled}
                onChange={(e) => {
                  if (e.target.checked) { setFaceConsentOpen(true); return }
                  void applyFaceFinder(false)
                }}
                className="h-4 w-4"
              />
            </label>

            {/* Bib search — the "this is a race" switch. Turning it on is what makes photos get read
                for bib numbers; leaving it off means this album never sends a single photo out for
                OCR. FEATURE_TIER.bibSearch says which plan. */}
            <OptimisticToggle
              album={album}
              field="bib_search_enabled"
              checked={(v) => !!v}
              save={saveBibSearchRequest}
              onAlbumUpdated={onAlbumUpdated}
              disabled={!rows.bibSearch.enabled}
              className="mt-3 flex items-start justify-between gap-3 rounded-xl px-3 py-3 cursor-pointer"
              rowStyle={{ background: '#FFFFFF', border: '1px solid #E8E0D2' }}
              labelClassName="flex items-center gap-2 text-sm font-semibold"
              label={<><Search className="w-4 h-4" />{t('ot.bibSearch')} <PlanBadge need={FEATURE_TIER.bibSearch} tier={userTier} /></>}
              sub={t('ot.bibSearchSub')}
            />
          </div>
        )}
      </section>

      {/* PORTALLED. The Settings pop-over keeps a transform after its entrance animation, and a
          transformed ancestor becomes the containing block for `position: fixed` -- so rendered
          in place, the full-screen consent overlay was a 480px panel trapped inside the dropdown,
          with the page behind it neither dimmed nor blocked. A review measured it in a headless
          browser. document.body has no transform. */}
      {faceConsentOpen && createPortal(
        <FaceConsentDialog
          onCancel={() => setFaceConsentOpen(false)}
          onConfirm={() => { setFaceConsentOpen(false); void applyFaceFinder(true) }}
        />,
        document.body,
      )}
    </>
  )
}
