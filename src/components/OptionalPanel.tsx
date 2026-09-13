'use client'

import type { CSSProperties, ReactNode } from 'react'
import ErrorBoundary from '@/components/ErrorBoundary'
import { useT } from '@/i18n/LocaleProvider'
import { failOptionalPart, type OptionalPart } from '@/lib/optional-load'

// ONE PART OF THE ALBUM PAGE FAILING MUST NOT TAKE THE ALBUM WITH IT.
//
// The album page lazy-loads its upload panel, owner toolbar, face finder and designer. None had an
// error boundary, though components/ErrorBoundary existed and was used nowhere. When a guest's device
// would not fetch the upload panel's chunk group -- 26 production rows since 2026-08-22, cause on the
// device still unexplained -- the rejection reached the route error boundary and the whole album was
// replaced by "Something went wrong". The photos they came to see were fine.
//
// The decisions are lib/optional-load's: spend the page's one stale-deploy reload while it is still
// available (a real stale deploy heals itself, as it did before), and once it has been spent, contain
// the failure to this part and report it -- a load failure in words that reload nothing, a crash in its
// own words with the component that threw. lib/optional-load's failOptionalPart carries them out; this
// file only catches the failure and shows the one line a guest sees.

// The top of the screen, above the Settings sheet and apart from the toasts at the bottom. For a part
// that opens as a full-screen overlay: its place in the page is below the photo grid, where a fallback
// would appear nowhere near the button the owner just tapped.
const FLOATING: CSSProperties = { position: 'fixed', top: 16, left: 0, right: 0, zIndex: 400, width: 'fit-content', marginInline: 'auto' }

export default function OptionalPanel({
  part,
  children,
  floating = false,
  onRetry = () => window.location.reload(),
}: {
  part: OptionalPart
  children: ReactNode
  /** Show the fallback at the top of the screen instead of where the part sits in the page. */
  floating?: boolean
  /** Injected for tests. A real retry has to reload: a lazy component caches its rejected import, so re-rendering would only fail again. */
  onRetry?: () => void
}) {
  const { t } = useT()
  return (
    <ErrorBoundary
      onError={(error, info) => { failOptionalPart(part, error, info.componentStack) }}
      fallback={
        <div role="alert" className="flex justify-center px-4 py-3" style={floating ? FLOATING : undefined}>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full px-4 py-2 text-sm font-semibold transition hover:opacity-80"
            style={{ background: '#F5F0E8', border: '1px solid #DDD5C5', color: '#630826' }}
          >
            {t('common.errorGeneric')}
          </button>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  )
}
