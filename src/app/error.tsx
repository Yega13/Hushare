'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { reportClientError, stackFrames } from '@/lib/report-error'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Previously dev-only, which meant every crash a real user saw was invisible. The digest is the
  // key that ties this back to the matching server-side log line.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[app/error]', error.digest ?? error.message)
    }
    reportClientError({
      source: 'app/error',
      // The boundary rendered instead of the page: whatever was on screen is already gone,
      // so a recovery reload can cost nothing further. See report-error.ts.
      fatal: true,
      message: error.message || 'unknown render error',
      context: { digest: error.digest, stack: stackFrames(error.stack) },
    })
  }, [error])

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ background: '#FDFAF5' }}
    >
      <h1
        className="text-3xl font-bold mb-3"
        style={{ color: '#630826', fontFamily: 'var(--font-serif)' }}
      >
        Something went wrong
      </h1>
      <p className="text-sm mb-8 max-w-sm" style={{ color: '#5C4A3C' }}>
        An unexpected error occurred. You can try again or go back to the homepage.
      </p>
      <div className="flex gap-3 flex-wrap justify-center">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl px-5 py-2.5 text-sm font-semibold transition hover:opacity-90"
          style={{ background: '#630826', color: '#FDFAF5' }}
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-xl px-5 py-2.5 text-sm font-semibold transition hover:opacity-80"
          style={{ background: '#F0EAE0', color: '#630826' }}
        >
          Go home
        </Link>
      </div>
    </main>
  )
}
