'use client'

import { useState } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import type { Album } from '@/types'
import { BIN_DAYS } from '@/lib/album-bin'
import { deleteFlowNext, deleteTapSends, DELETE_IDLE, type DeleteFlow } from '@/lib/delete-flow'
import { showAppToast, storeAppToast } from '@/components/AppToast'
import { deleteAlbumRequest, restoreAlbumRequest } from '@/components/owner-toolbar/api'
import { accordionButton, sectionTitle, settingsSectionStyle } from '@/components/owner-toolbar/styles'
import { useT } from '@/i18n/LocaleProvider'

// THE DELETE PANEL. The two-tap confirm, the error where the tap was, and -- since deleting became
// a bin -- the undo shown BEFORE any redirect: an undo the owner cannot reach is not an undo. The
// transitions are lib/delete-flow, tested one by one.
//
// The panel body owns the CONFIRM flow and is mounted only while the accordion is open, so closing
// it resets to idle: a half-armed red "Delete permanently" button does not survive a close and
// reopen (the old inline version kept it armed; requiring the first tap again is the safe direction
// for the one action with a deadline on its undo).
//
// THE DELETED STATE IS NOT THE BODY'S TO KEEP. A review traced the sequence: owner taps "Delete
// permanently", closes the accordion (or taps outside, which closes Settings) while the request is
// in flight, and the success lands on an unmounted body -- nothing shown, the album still on screen,
// a retry answering "Album not found". So a completed deletion is reported UP through onDeleted; the
// toolbar holds `deletedFor`, reopens Settings on this section, and hands it back as a prop, which
// this renders as the undo whatever the body's own flow says. An undo the owner cannot reach is
// not an undo.

type Props = {
  album: Album
  open: boolean
  onToggle: () => void
  /** Set by the toolbar once a deletion has landed: how many days the album is restorable for. */
  deletedFor: number | null
  onDeleted: (restorableForDays: number) => void
}

export default function DangerSection({ album, open, onToggle, deletedFor, onDeleted }: Props) {
  const { t } = useT()
  return (
    <section style={{ ...settingsSectionStyle, marginBottom: 0 }}>
      <button type="button" className="hush-motion" style={accordionButton} onClick={onToggle}>
        <Trash2 className="w-4 h-4" style={{ color: '#C0392B' }} />
        <span style={sectionTitle}>{t('ot.deleteAlbum')}</span>
        <ChevronDown
          className="ml-auto w-4 h-4 transition-transform"
          style={{ color: '#A89880', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      {open && <DangerPanel album={album} deletedFor={deletedFor} onDeleted={onDeleted} />}
    </section>
  )
}

function DangerPanel({ album, deletedFor, onDeleted }: { album: Album; deletedFor: number | null; onDeleted: (days: number) => void }) {
  const { t } = useT()
  const [flow, setFlow] = useState<DeleteFlow>(DELETE_IDLE)
  const [restoring, setRestoring] = useState(false)

  async function tap() {
    if (!deleteTapSends(flow)) {
      setFlow((f) => deleteFlowNext(f, { type: 'tap' }))
      return
    }
    setFlow((f) => deleteFlowNext(f, { type: 'tap' }))
    try {
      const result = await deleteAlbumRequest(album.slug)
      if (!result.ok) {
        setFlow((f) => deleteFlowNext(f, { type: 'failed', error: result.error }))
        showAppToast(result.error, 'error')
        return
      }
      // NOT redirected yet. The owner gets the chance to undo first; leaving is their choice.
      // Reported up FIRST: this body may already be unmounted (see the header), and the toolbar
      // is what survives to show the undo.
      onDeleted(result.restorableForDays)
      setFlow((f) => deleteFlowNext(f, { type: 'succeeded', restorableForDays: result.restorableForDays }))
    } catch (e) {
      const message = e instanceof Error ? e.message : t('common.networkError')
      setFlow((f) => deleteFlowNext(f, { type: 'failed', error: message }))
      showAppToast(message, 'error')
    }
  }

  async function restore() {
    setRestoring(true)
    try {
      const result = await restoreAlbumRequest(album.slug)
      if (!result.ok) {
        showAppToast(result.error, 'error')
        return
      }
      storeAppToast(t('ot.albumRestored'))
      window.location.reload()
    } catch (e) {
      showAppToast(e instanceof Error ? e.message : t('common.networkError'), 'error')
    } finally {
      setRestoring(false)
    }
  }

  const confirming = flow.phase === 'confirm'
  const error = flow.phase === 'confirm' ? flow.error : ''
  // The toolbar's answer outranks the body's: a deletion that landed while this was unmounted.
  const restorableForDays = deletedFor ?? (flow.phase === 'deleted' ? flow.restorableForDays : null)

  return (
    <div className="px-4 pb-4">
      <div className={`hush-delete-dialog hush-delete-panel rounded-xl p-3 ${confirming ? 'hush-delete-dialog-open' : ''}`} style={{ background: '#FFF7F4', border: '1px solid rgba(192,57,43,0.25)' }}>
        {restorableForDays !== null ? (
          // DELETED, AND STILL RECOVERABLE. The redirect waits here on purpose.
          <div>
            <p className="text-xs leading-relaxed mb-3" style={{ color: '#7A2A1F' }}>
              {t('ot.albumDeleted')} {t('ot.restorableFor').replace('{days}', String(restorableForDays))}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void restore()}
                disabled={restoring}
                className="hush-press flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: '#FFFFFF', border: '1px solid #630826', color: '#630826' }}
              >
                {restoring ? t('ot.restoring') : t('ot.undoDelete')}
              </button>
              <button
                type="button"
                onClick={() => { storeAppToast(t('ot.albumDeleted')); window.location.href = '/' }}
                className="hush-press rounded-lg px-3 py-2 text-sm font-semibold transition hover:opacity-90"
                style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#7C5C3E' }}
              >
                {t('ot.done')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs leading-relaxed mb-3" style={{ color: '#7A2A1F' }}>
              {t('ot.deleteSub')}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void tap()}
                disabled={flow.phase === 'deleting'}
                className="hush-press flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: confirming ? '#C0392B' : '#FFFFFF', border: '1px solid #C0392B', color: confirming ? '#FFFFFF' : '#C0392B' }}
              >
                <Trash2 className="w-4 h-4" />
                {flow.phase === 'deleting' ? t('ot.deleting') : confirming ? t('ot.deletePermanently') : t('ot.deleteAlbum')}
              </button>
              {confirming && (
                <button
                  type="button"
                  onClick={() => setFlow((f) => deleteFlowNext(f, { type: 'cancel' }))}
                  className="hush-press rounded-lg px-3 py-2 text-sm font-semibold transition hover:opacity-90"
                  style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#7C5C3E' }}
                >
                  Cancel
                </button>
              )}
            </div>
            {confirming && !error && (
              <p className="mt-2 text-xs" style={{ color: '#7A2A1F' }}>
                {/* It CAN be undone now, for a week. The scarier sentence is the one that stops
                    somebody deleting a duplicate album they meant to tidy up. */}
                {t('ot.deleteConfirmHint').replace('{days}', String(BIN_DAYS))}
              </p>
            )}
            {error && <p className="mt-2 text-xs" style={{ color: '#C0392B' }}>{error}</p>}
          </>
        )}
      </div>
    </div>
  )
}
