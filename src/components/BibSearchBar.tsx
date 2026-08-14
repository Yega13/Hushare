'use client'

import { Search, X } from 'lucide-react'
import { useT } from '@/i18n/LocaleProvider'
import type { Photo } from '@/types'

// Guest-facing bib search. Filters the album IN PLACE rather than opening a separate results
// screen: a runner types their number and the same grid they're already looking at narrows to
// their photos. Matching happens client-side against bib_numbers already loaded with the photos,
// so results are instant and typing costs no network requests.

const BRAND = '#630826', BORDER = '#DDD5C5', MUTED = '#8A7A66'

type Props = {
  query: string
  onQueryChange: (q: string) => void
  matchCount: number
  indexedCount: number
  totalImages: number
  // Face Finder is the escape hatch when a number can't be read. Absent when the owner has it off.
  onTryFaceFinder?: () => void
}

export type BibRange = { min: number | null; max: number | null }

// A bib matches if the typed digits equal the detected number, ignoring the leading zeros race
// bibs are usually printed with — a runner reading "00945" off their chest types "945" as often
// as not, and both must work. This also rescues OCR that drops a zero: "0994" and "00994" both
// normalise to 994.
//
// `range` discards detections outside the race's numbering before comparing. OCR reads every
// number in the frame, including banner years and lap counters, and on a race numbered 1-500 a
// stray "14" would otherwise hand runner 14 a photo they are not in. Filtering here rather than at
// indexing time means correcting the range is instant and costs no re-OCR.
export function bibMatches(photo: Photo, query: string, range?: BibRange): boolean {
  const q = query.replace(/\D/g, '')
  if (!q) return true
  const wanted = Number(q)
  return (photo.bib_numbers ?? []).some((b) => {
    const n = Number(b)
    if (!Number.isFinite(n)) return false
    if (range?.min != null && n < range.min) return false
    if (range?.max != null && n > range.max) return false
    return n === wanted
  })
}

export default function BibSearchBar({ query, onQueryChange, matchCount, indexedCount, totalImages, onTryFaceFinder }: Props) {
  const { t } = useT()
  const searching = query.replace(/\D/g, '').length > 0
  // Indexing runs in the background after upload, so an album can be mid-way through. Saying so
  // is better than a runner concluding their photos don't exist when they simply aren't read yet.
  const stillIndexing = indexedCount < totalImages

  return (
    <div className="hush-container" style={{ paddingInline: 'clamp(14px, 4vw, 20px)', marginTop: 14 }}>
      {/* A card rather than a bare input: on a race album this is the primary action, and it has
          to read that way next to a large upload panel. */}
      <div style={{ background: '#FFFFFF', border: `1px solid ${BORDER}`, borderRadius: 16, padding: 'clamp(14px, 3vw, 18px)' }}>
        <p style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700, color: BRAND, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search className="w-4 h-4" />
          {t('bib.title')}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 260 }}>
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              enterKeyHint="search"
              placeholder={t('bib.placeholder')}
              aria-label={t('bib.placeholder')}
              style={{
                width: '100%', padding: '11px 34px 11px 14px', fontSize: 17, fontWeight: 600,
                letterSpacing: '0.04em', fontVariantNumeric: 'tabular-nums',
                borderRadius: 11, border: `1.5px solid ${BORDER}`, background: '#FDFAF5', color: '#2A211C',
              }}
            />
            {searching && (
              <button
                type="button" onClick={() => onQueryChange('')} aria-label={t('bib.clear')}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: MUTED, display: 'flex' }}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {searching ? (
            <span style={{ fontSize: 14, color: matchCount > 0 ? BRAND : MUTED, fontWeight: 700 }}>
              {matchCount > 0 ? t('bib.found', { n: matchCount }) : t('bib.none')}
            </span>
          ) : (
            <span style={{ fontSize: 13, color: MUTED }}>{t('bib.hint')}</span>
          )}
        </div>

        {searching && stillIndexing && (
          <p style={{ fontSize: 12, color: MUTED, margin: '8px 0 0' }}>
            {t('bib.stillIndexing', { done: indexedCount, total: totalImages })}
          </p>
        )}

        {/* A number search that finds nothing must never be a dead end. Measured on a real race
            album, only about half the photos have a readable number at all — a bib is hidden by an
            arm, folded, blurred by motion, or the runner is shot from behind. So "no photos" here
            usually means "we couldn't READ your number", not "you aren't in any photo", and sending
            the runner to Face Finder finds them in exactly the shots where the number failed.
            Without this, the most likely single outcome of a race-day search is a blank screen. */}
        {searching && matchCount === 0 && !stillIndexing && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
            <p style={{ fontSize: 13, lineHeight: 1.5, color: MUTED, margin: 0 }}>
              {onTryFaceFinder ? t('bib.noneHelpFace') : t('bib.noneHelp')}
            </p>
            {onTryFaceFinder && (
              <button
                type="button"
                onClick={onTryFaceFinder}
                className="hush-press"
                style={{
                  marginTop: 10, padding: '10px 18px', fontSize: 14, fontWeight: 700,
                  color: '#FDFAF5', background: BRAND, border: 'none', borderRadius: 10, cursor: 'pointer',
                }}
              >
                {t('bib.tryFaceFinder')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
