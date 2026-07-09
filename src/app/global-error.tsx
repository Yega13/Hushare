'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[app/global-error]', error.digest ?? error.message)
    }
  }, [error])

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{
        margin: 0,
        fontFamily: 'system-ui, sans-serif',
        background: '#FDFAF5',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: '0.75rem',
        padding: '1.5rem',
        textAlign: 'center',
        boxSizing: 'border-box',
      }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.5rem', color: '#630826' }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: '0.875rem', margin: '0 0 1.5rem', color: '#5C4A3C', maxWidth: '24rem' }}>
          An unexpected error occurred. You can try again or go back to the homepage.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '0.625rem 1.25rem',
              borderRadius: '0.75rem',
              border: 'none',
              background: '#630826',
              color: '#FDFAF5',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{
              padding: '0.625rem 1.25rem',
              borderRadius: '0.75rem',
              background: '#F0EAE0',
              color: '#630826',
              fontWeight: 600,
              fontSize: '0.875rem',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            Go home
          </a>
        </div>
      </body>
    </html>
  )
}
