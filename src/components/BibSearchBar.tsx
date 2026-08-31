'use client'

import { Search, X } from 'lucide-react'
import { useT } from '@/i18n/LocaleProvider'
import { bibMatches, type BibRange } from '@/lib/bib-match'

// Re-exported so the album page keeps importing the matcher from the search bar it belongs to.
// The rule itself lives in lib/bib-match.ts because the server needs the same one.
export { bibMatches }
export type { BibRange }

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
  /** The TRUE number of matches, which can exceed the rows returned — the search is capped so a
   *  junk OCR reading off a banner cannot pull thousands of rows. Null until the server answers. */
  totalMatches: number | null
  /** True while the authoritative answer for the current query is still in flight. */
  awaitingServer: boolean
  /** The search request failed. The bar must say so rather than show an empty result as fact. */
  failed: boolean
  onRetry: () => void
  // Face Finder is the escape hatch when a number can't be read. Absent when the owner has it off.
  onTryFaceFinder?: () => void
}

export default function BibSearchBar({ query, onQueryChange, matchCount, totalMatches, indexedCount, totalImages, awaitingServer, failed, onRetry, onTryFaceFinder }: Props) {
  const { t } = useT()
  const searching = query.replace(/\D/g, '').length > 0
  // Indexing runs in the background after upload, so an album can be mid-way through. Saying so
  // is better than a runner concluding their photos don't exist when they simply aren't read yet.
  //
  // Both counts come from the server and cover the whole album, so they no longer agree with each
  // other by accident on a partly-loaded one — that bug had a runner at bib 3,400 told with total
  // confidence that they were not photographed.
  // Only when photos are GENUINELY unread. "4,565 of 4,565" is a finished album, and telling a
  // runner it is still reading makes them wait for something that already happened — the mirror
  // of rule 20's forbidden negative: an unbacked "not yet".
  const stillIndexing = totalImages > 0 && indexedCount < totalImages
  // NOTHING NEGATIVE MAY BE STATED UNTIL THE REAL ANSWER IS IN. While the request is in flight the
  // grid is showing a local filter over the photos this phone happens to hold, which on a big album
  // is not the answer — and if the request failed, there is no answer at all.
  const answerIsFinal = !awaitingServer && !failed
  // Saying "300 photos" when the answer was cut off at 300 states a cap as a total. It only happens
  // on a number OCR read off something that is not a bib, but the fix for that is the album's
  // number range, not a bar that rounds the truth off.
  const capped = totalMatches != null && totalMatches > matchCount

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
                style={{
                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  // A real centred square: the icon used to sit flush against the input's right
                  // padding, which read as "not in the middle" of its own button. 28px is also a
                  // findable tap target on a phone; the icon centres inside it.
                  width: 28, height: 28, padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'none', border: 'none', cursor: 'pointer', color: MUTED,
                }}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {searching ? (
            <span style={{ fontSize: 14, color: matchCount > 0 ? BRAND : MUTED, fontWeight: 700 }}>
              {/* Order matters: a failure and an unfinished search both outrank a count of zero,
                  because zero is only true once the server has said so. */}
              {failed ? t('bib.failed')
                : !answerIsFinal ? t('bib.searching')
                : capped ? t('bib.foundCapped', { n: matchCount, total: totalMatches })
                : matchCount > 0 ? t('bib.found', { n: matchCount })
                : t('bib.none')}
            </span>
          ) : (
            <span style={{ fontSize: 13, color: MUTED }}>{t('bib.hint')}</span>
          )}
        </div>

        {searching && failed && (
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={onRetry}
              className="hush-press"
              style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 700, color: '#FDFAF5',
                background: BRAND, border: 'none', borderRadius: 10, cursor: 'pointer',
              }}
            >
              {t('bib.retry')}
            </button>
          </div>
        )}

        {searching && !failed && stillIndexing && (
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
        {/* SHOWN EVEN WHILE INDEXING IS BEHIND. This used to require !stillIndexing, which sounds
            careful and hid the escape hatch for the entire event: during a live race the
            photographer uploads continuously and OCR chains behind in batches, so "indexed <
            total" is true almost the whole time. One photo whose OCR permanently fails keeps it
            true forever. A runner who searched and found nothing was then shown no way forward at
            the exact moment they needed one. The "still reading photos" note above already says
            the album is incomplete; this offers them something to do about it. */}
        {searching && matchCount === 0 && answerIsFinal && (
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
