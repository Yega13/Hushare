'use client'

import { ChevronDown, ShieldCheck } from 'lucide-react'
import type { Album, Tier } from '@/types'
import { FEATURE_TIER } from '@/lib/plan-gates'
import type { RowLook } from '@/lib/owner-rows'
import { saveGuestDownloadsRequest, saveGuestUploadsRequest, saveRequireApprovalRequest } from '@/components/owner-toolbar/api'
import OptimisticToggle from '@/components/owner-toolbar/OptimisticToggle'
import { accordionButton, sectionTitle, settingsSectionStyle } from '@/components/owner-toolbar/styles'
import PlanBadge, { gatedRowStyle } from '@/components/PlanBadge'
import { useT } from '@/i18n/LocaleProvider'

// THE GUESTS PANEL: whether guests may add photos, whether they may download, whether what they
// add needs approval. No state of its own -- each switch reads the album and writes back through
// onAlbumUpdated (see OptimisticToggle).

type Props = {
  album: Album
  userTier: Tier | null
  moderation: RowLook
  open: boolean
  onToggle: () => void
  onAlbumUpdated: (patch: Partial<Album>) => void
}

export default function GuestsSection({ album, userTier, moderation, open, onToggle, onAlbumUpdated }: Props) {
  const { t } = useT()
  // The moot-moderation COPY needs the reason, not just the look (lib/owner-rows owns the look).
  const moderationIsMoot = album.guest_uploads_enabled === false

  return (
    <section style={settingsSectionStyle}>
      <button type="button" className="hush-motion" style={accordionButton} onClick={onToggle}>
        <ShieldCheck className="w-4 h-4" style={{ color: '#7C5C3E' }} />
        <span style={sectionTitle}>{t('ot.guests')}</span>
        <ChevronDown
          className="ml-auto w-4 h-4 transition-transform"
          style={{ color: '#A89880', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* WHO MAY ADD PHOTOS. The server has always enforced this — photos/create, presign,
              stream and image-relay all refuse when it is off — but nothing could SET it, so the
              only way to close an album to guests was an UPDATE against the database by hand. It
              sits first because it is the biggest switch here: everything else shapes what guests
              see, this decides whether they contribute at all. */}
          <OptimisticToggle
            album={album}
            field="guest_uploads_enabled"
            checked={(v) => v !== false}
            save={saveGuestUploadsRequest}
            onAlbumUpdated={onAlbumUpdated}
            label={t('ot.allowUploads')}
            sub={t('ot.allowUploadsSub')}
          />

          <OptimisticToggle
            album={album}
            field="allow_guest_downloads"
            checked={(v) => v !== false}
            save={saveGuestDownloadsRequest}
            onAlbumUpdated={onAlbumUpdated}
            label={t('ot.allowDownloads')}
            sub={t('ot.allowDownloadsSub')}
          />

          <OptimisticToggle
            album={album}
            field="require_approval"
            checked={(v) => !!v}
            save={saveRequireApprovalRequest}
            onAlbumUpdated={onAlbumUpdated}
            disabled={!moderation.enabled}
            rowStyle={gatedRowStyle(moderation.dimmed, !moderation.show)}
            label={<>{t('ot.requireApproval')} <PlanBadge need={FEATURE_TIER.photoModeration} tier={userTier} /></>}
            sub={moderationIsMoot ? t('ot.requireApprovalMoot') : t('ot.requireApprovalSub')}
          />
        </div>
      )}
    </section>
  )
}
