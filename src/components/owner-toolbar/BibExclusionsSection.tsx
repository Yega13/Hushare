'use client'

import { useEffect, useState } from 'react'
import type { Album } from '@/types'
import { showAppToast } from '@/components/AppToast'
import {
  fetchBibExclusions, saveBibExclusionsRequest, type BibExclusionsView,
} from '@/components/owner-toolbar/api'
import { isExcludedNumber, numericKey } from '@/lib/bib-exclusions'
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
// before anyone tried it. So this panel never decides, and a real bib appears in the list by design.
//
// WHICH IS WHY IT SHOWS A PHOTOGRAPH. The first version listed numbers and counts, and the owner's
// first reaction was that it could not be answered: "is 2026 a runner?" is close to unanswerable
// from a number and obvious in one glance at the picture. The thumbnail turns a quiz into a look.
// The bar does the same job for scale -- a number on a quarter of the album is visibly not a person,
// and that is an argument the owner can check rather than a threshold they have to trust.
//
// EVERY EXCLUSION IS UNDOABLE, and that is load-bearing rather than a nicety. Aimed at a real bib
// this removes a runner from their own search -- and unlike every other mistake in this product,
// that one produces no complaint: they look, find nothing, and conclude they were not photographed.

type Props = {
  album: Album
  /** The album's photo total, so a count can be shown as a share of it. */
  albumPhotoCount?: number
}

/** Rows shown before the "+N" reveal. Enough to cover the obvious signage on a real race without
 *  turning a dropdown into a wall -- the measured album's four offenders are all in the first four. */
const COLLAPSED = 6

export default function BibExclusionsSection({ album, albumPhotoCount }: Props) {
  const { t } = useT()
  const [view, setView] = useState<BibExclusionsView | null>(null)
  // FAILED IS NOT EMPTY. Without this the panel says "no numbers found on many photos" when the
  // request fell over, which is a claim about the album we do not hold (rule 20).
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Nothing is set synchronously here: clearing `failed` on the way IN would flash the panel back
    // into view on every slug change before the new answer exists.
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
    // BY VALUE, NOT BY TEXT, both ways -- lib/bib-exclusions decides what "the same number" means
    // and bib search compares the same way. OCR keeps leading zeros while the route stores the
    // canonical form, so a row read as "00945" and a stored "945" are one number. Comparing text
    // made a just-excluded row spring back ON the moment the server's answer arrived, and made a
    // second tap post the number again instead of removing it.
    const key = numericKey(number)
    const isExcluded = isExcludedNumber(number, view.excluded)
    // THE WHOLE LIST, because the route replaces rather than merges.
    const next = isExcluded
      ? view.excluded.filter((n) => numericKey(n) !== key)
      : [...view.excluded, number]

    const before = view
    setSaving(number)
    // Optimistic, so a tap feels immediate. The previous list is restored on failure: a row that
    // LOOKS excluded while the server refused is the same class of lie as the empty states this
    // feature exists to remove.
    setView({ ...view, excluded: next })
    try {
      const result = await saveBibExclusionsRequest(album.slug, next)
      if (!result.ok) {
        setView(before)
        showAppToast(result.error, 'error')
        return
      }
      // The SERVER's list: it canonicalises, so this is what a search will actually use.
      setView({ ...before, excluded: result.excluded })
    } catch (e) {
      setView(before)
      showAppToast(e instanceof Error ? e.message : t('common.networkError'), 'error')
    } finally {
      setSaving(null)
    }
  }

  if (failed || !view) return null
  const { rows, excluded } = view
  if (rows.length === 0) return null

  // ONE ROW PER NUMBER, ORDERED ONCE, IN lib. This component used to build the list from the
  // candidate set plus the excluded set, which put a just-switched-off number on screen twice and
  // then, after a reload, reduced it to a struck-through digit string with a blank square and no
  // count -- because the server stops offering an excluded number as a candidate. `rows` carries
  // both, with the photograph and the count intact, which is what makes an exclusion undoable.
  const shown = expanded ? rows : rows.slice(0, COLLAPSED)
  // The bar is a share of the ALBUM where that is known, because "a quarter of your photographs"
  // is the fact that decides this. Falling back to a share of the biggest number keeps the bars
  // meaningful rather than all full-width when the total has not been passed down.
  const scale = albumPhotoCount && albumPhotoCount > 0
    ? albumPhotoCount
    : Math.max(1, ...rows.map((r) => r.photos))

  return (
    <div className="mt-3 rounded-xl px-3 py-3" style={{ background: '#FDFAF5', border: '1px solid #E8E0D2' }}>
      <p className="text-sm font-semibold" style={{ color: '#630826' }}>{t('ot.bibExclusions')}</p>
      <p className="text-xs mt-1 mb-3" style={{ color: '#7C5C3E' }}>{t('ot.bibExclusionsSub')}</p>

      <div className="space-y-1">
        {shown.map((row) => {
          const number = row.number
          const off = isExcludedNumber(number, excluded)
          const share = Math.min(100, Math.round((row.photos / scale) * 100))
          return (
            <button
              key={number}
              type="button"
              onClick={() => void toggle(number)}
              disabled={saving !== null}
              aria-pressed={off}
              className="hush-press flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition"
              style={{
                background: off ? '#F3E7EA' : '#FFFFFF',
                border: `1px solid ${off ? '#D9BCC4' : '#E8E0D2'}`,
                opacity: saving === number ? 0.5 : 1,
              }}
            >
              {/* THE POINT OF THE WHOLE ROW. One look answers what a number cannot: the arch, the
                  advertising board, or a runner. Absent only for a legacy row with no thumbnail. */}
              {row.sampleThumb
                ? (
                  // A 32px CDN thumbnail inside a dropdown: next/image would add a loader round
                  // trip and a layout wrapper for no benefit at this size. The directive below has
                  // to be the LAST line before the tag -- with this explanation under it instead,
                  // "next line" was the comment, the rule still fired, and the disable itself was
                  // reported as unused. Both showed up in the lint ratchet at once.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={row.sampleThumb}
                    alt=""
                    width={32}
                    height={32}
                    loading="lazy"
                    className="shrink-0 rounded object-cover"
                    style={{ width: 32, height: 32, filter: off ? 'grayscale(1)' : 'none' }}
                  />
                )
                : <span className="shrink-0 rounded" style={{ width: 32, height: 32, background: '#EFE7DA' }} />}

              <span
                className="shrink-0 text-sm font-bold tabular-nums"
                style={{ color: '#630826', textDecoration: off ? 'line-through' : 'none', minWidth: 46 }}
              >
                {number}
              </span>

              <span className="min-w-0 flex-1">
                {/* Scale, as something to look at rather than a number to interpret. No runner is in
                    a quarter of the album; the bar says that without asserting it. */}
                <span className="block h-1.5 w-full overflow-hidden rounded-full" style={{ background: '#EFE7DA' }}>
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${Math.max(share, 2)}%`, background: off ? '#B79AA3' : '#630826' }}
                  />
                </span>
                {/* Shown for an excluded number too: "on 1,145 photographs" is the whole argument
                    for having switched it off, and the owner needs it again to decide whether they
                    were right. Absent only at zero -- an exclusion whose photographs are gone. */}
                {row.photos > 0 && (
                  <span className="mt-0.5 block text-[11px] leading-none" style={{ color: '#8B6F4E' }}>
                    {t('album.photos', { n: row.photos })}
                  </span>
                )}
              </span>

              <span
                className="shrink-0 text-[11px] font-semibold"
                style={{ color: off ? '#630826' : '#B7A996', minWidth: 16, textAlign: 'right' }}
                aria-hidden
              >
                {off ? '✕' : ''}
              </span>
            </button>
          )
        })}
      </div>

      {/* A COUNT, NOT A WORD: no thirteenth string to translate, and "+14" says the same thing in
          every language this album is read in. */}
      {!expanded && rows.length > COLLAPSED && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="hush-press mt-2 w-full rounded-lg py-1.5 text-xs font-semibold"
          style={{ background: '#FFFFFF', border: '1px solid #E8E0D2', color: '#7C5C3E' }}
        >
          +{rows.length - COLLAPSED}
        </button>
      )}
    </div>
  )
}
