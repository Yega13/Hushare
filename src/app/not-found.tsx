import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Album not found — Hushare',
  robots: { index: false, follow: false },
}

export default function NotFound() {
  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-6 text-center"
      style={{ background: '#FDFAF5' }}
    >
      <div className="flex flex-col items-center gap-8 max-w-sm w-full">
        <Link href="/" aria-label="Hushare home">
          <Image
            src="/logo/logo-dark-transparent.png"
            alt="Hushare"
            width={618}
            height={146}
            style={{ width: 'auto', maxWidth: '120px' }}
            priority
          />
        </Link>

        <div>
          <p
            className="font-semibold uppercase mb-3"
            style={{ fontSize: '11px', color: '#8B6F4E', letterSpacing: '0.2em' }}
          >
            404
          </p>
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              color: '#630826',
              fontSize: 'clamp(1.6rem, 5vw, 2.4rem)',
              fontWeight: 700,
              lineHeight: 1.2,
            }}
          >
            Album not found
          </h1>
          <p className="mt-3 text-sm" style={{ color: '#8B6F4E' }}>
            This album may have been deleted, expired, or the link might be wrong.
          </p>
        </div>

        <Link
          href="/"
          className="rounded-xl px-6 py-3 font-semibold text-sm transition hover:opacity-85"
          style={{ background: '#630826', color: '#FDFAF5' }}
        >
          Create a new album
        </Link>
      </div>
    </div>
  )
}
