'use client'

import type { ReactNode } from 'react'
import ErrorBoundary from '@/components/ErrorBoundary'
import { useT } from '@/i18n/LocaleProvider'
import { reportClientError, reloadOnceForStaleDeploy, staleReloadStillAvailable } from '@/lib/report-error'
import { optionalLoadFailure, shouldReloadForOptional, type OptionalPart } from '@/lib/optional-load'

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
// the failure to this part and report it in words that reload nothing. This file only carries them
// out, plus the one line a guest sees.
export default function OptionalPanel({
  part,
  children,
  onRetry = () => window.location.reload(),
}: {
  part: OptionalPart
  children: ReactNode
  /** Injected for tests. A real retry has to reload: a lazy component caches its rejected import, so re-rendering would only fail again. */
  onRetry?: () => void
}) {
  const { t } = useT()
  return (
    <ErrorBoundary
      onError={(error) => {
        const reloading = shouldReloadForOptional(part, error, staleReloadStillAvailable())
        reportClientError(optionalLoadFailure(part, error, reloading))
        if (reloading) reloadOnceForStaleDeploy()
      }}
      fallback={
        <div role="alert" className="flex justify-center px-4 py-3">
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
