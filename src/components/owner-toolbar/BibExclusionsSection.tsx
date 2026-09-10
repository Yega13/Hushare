'use client'

import { useEffect, useState } from 'react'
import type { Album } from '@/types'
import { showAppToast } from '@/components/AppToast'
import {
  fetchBibExclusions, saveBibExclusionsRequest, type BibExclusionsView,
} from '@/components/owner-toolbar/api'
import { useT } from '@/i18n/LocaleProvider'

// THE HALF OF BIB SEARCH A RULE CANNOT DO.
//
// lib/bib-filter refuses any number sharing its OCR line, which removes the billboards and the
// dated banners -- 96.3% of the noise, measured on two races. What survives is a number printed
// ALONE, and a year across a finish arch is typographically identical to a bib on a chest. On the
// measured album about 75 photographs still answer to 2026, and 2026 is inside that race's own 2xxx
// numbering, so no range can remove it without removing runners with it.
//
// FREQUENCY NOMINATES; THE OWNER DECIDES. On the 69-photo album the banner year and the real bib
// 00663 each appeared on exactly 4 photographs -- 20260814_bib_range.sql recorded that warning
// before anyone tried it, and a later measurement confirmed it. So this panel offers counts and
// takes an answer. It never decides, and a real bib appears in the list by design.
//
// EVERY EXCLUSION IS UNDOABLE, and that is the load-bearing property rather than a nicety. Aimed at
// a real bib, this removes a runner from their own search -- and unlike every other mistake in this
// product, that one produces no complaint: they look, find nothing, and conclude they were not
// photographed. So excluded numbers stay on screen, marked, and one tap puts them back.

type Props = { album: Album }

const CHIP = 'rounded-full px-3 py-1.5 text-xs font-semibold transition hush-press'

export default function BibExclusionsSection({ album }: Props) {
  const { t } = useT()
  const [view, setView] = useState<BibExclusionsView | null>(null)
  // FAILED IS NOT EMPTY. Without this the panel prints "no numbers found on many photos" when the
  // request fell over, which is a claim about the album we do not hold (rule 20).
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Nothing is set synchronously here. Clearing `failed` on the way IN would also clear it on
    // every slug change before the new answer exists, so the panel would flash back into view and
    // out again -- and it is a setState during the effect, which react-hooks flags for that family
    // of reason. The answer sets both, once, when it arrives.
    fetchBibExclusions(album.slug).then((v) => {
      if (cancelled) return
      if (v === null) { setFailed(true); return }
      setView(v)
      setFailed(false)
    })
    return () => { cancelled = true }
  }, [album.slug])

  async function toggle(number: string) {
    if (!view || saving) return
    const isExcluded = view.excluded.includes(number)
    // THE WHOLE LIST, because the route replaces rather than merges.
    const next = isExcluded
      ? view.excluded.filter((n) => n !== number)
      : [...view.excluded, number]

    const before = view
    setSaving(number)
    // Optimistic, so a tap feels immediate on a phone at an event. The previous list is kept and
    // restored on failure: a chip that LOOKS excluded while the server refused is the same class of
    // lie as the empty states this feature exists to remove.
    setView({ ...view, excluded: next })
    try {
      const result = await saveBibExclusionsRequest(album.slug, next)
      if (!result.ok) {
        setView(before)
        showAppToast(result.error, 'error')
        return
      }
      // The SERVER's list: it canonicalises, so what came back is what a search will actually use.
      setView({ ...before, excluded: result.excluded })
    } catch (e) {
      setView(before)
      showAppToast(e instanceof Error ? e.message : t('common.networkError'), 'error')
    } finally {
      setSaving(null)
    }
  }

  // Nothing to say yet, and nothing worth a spinner: the panel sits under a switch the owner has
  // just turned on, and an album with no numbers read yet genuinely has nothing to offer.
  if (failed || !view) return null
  const { candidates, excluded } = view
  if (candidates.length === 0 && excluded.length === 0) return null

  // ONE LIST, ONE CHIP PER NUMBER.
  //
  // This rendered the excluded set and the candidate set as two separate rows, and the first tap
  // proved why that is wrong: excluding a number adds it to one list without removing it from the
  // other, so "2026" appeared TWICE -- once dark and once still offering its count. The owner sees
  // a number they have just switched off apparently still on.
  //
  // A number is one thing with one state, so it gets one chip and the state is `pressed`. `order`
  // is fixed for the life of the panel rather than derived from the two sets, because deriving it
  // would make an un-excluded number vanish: the server does not return it as a candidate any more,
  // having been told it was excluded when the panel loaded.
  const counts = new Map(candidates.map((c) => [c.number, c.photos]))
  const order = [...new Set([...candidates.map((c) => c.number), ...excluded])]

  return (
    <div className="mt-3 rounded-xl px-3 py-3" style={{ background: '#FDFAF5', border: '1px solid #E8E0D2' }}>
      <p className="text-sm font-semibold" style={{ color: '#630826' }}>{t('ot.bibExclusions')}</p>
      <p className="text-xs mt-1 mb-3" style={{ color: '#7C5C3E' }}>{t('ot.bibExclusionsSub')}</p>

      <div className="flex flex-wrap gap-2">
        {order.map((number) => {
          const off = excluded.includes(number)
          const photos = counts.get(number)
          return (
            <button
              key={number}
              type="button"
              onClick={() => void toggle(number)}
              disabled={saving !== null}
              aria-pressed={off}
              className={CHIP}
              style={{
                background: off ? '#630826' : '#FFFFFF',
                border: off ? '1px solid #630826' : '1px solid #DDD5C5',
                color: off ? '#FFFFFF' : '#630826',
                opacity: saving === number ? 0.6 : 1,
                textDecoration: off ? 'line-through' : 'none',
              }}
            >
              {number}
              {/* The count is what makes the question answerable: "2026 -- on 1,145 photos" is
                  recognisably an arch, where a bare number is a guess. Absent only for a number
                  excluded before this panel opened, which the server no longer counts. */}
              {photos !== undefined && (
                <span className="ml-1.5 font-normal" style={{ color: off ? '#E8D5DA' : '#8B6F4E' }}>
                  {t('album.photos', { n: photos })}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
