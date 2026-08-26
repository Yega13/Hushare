import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { getServerLocale } from '@/i18n/server'
import { getDictionary } from '@/i18n/get-dictionary'

export const metadata: Metadata = {
  title: 'Album not found — Hushare',
  robots: { index: false, follow: false },
}

export default async function NotFound() {
  const dict = getDictionary(await getServerLocale())
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
            {dict['notFound.title']}
          </h1>
          <p className="mt-3 text-sm" style={{ color: '#8B6F4E' }}>
            {dict['notFound.body']}
          </p>
        </div>

        {/* TWO ways out, because this page is reached by two different people with opposite
            problems. "Create a new album" is the right answer for somebody who mistyped a URL and
            is useless for the two who actually arrive here: a guest sent a bad link to somebody
            else's wedding, and an owner whose own link has gone. Offering only that made the page a
            dead end for exactly the person who most needed it not to be. */}
        <div className="flex flex-col items-center gap-3 w-full">
          <Link
            href="/"
            className="rounded-xl px-6 py-3 font-semibold text-sm transition hover:opacity-85"
            style={{ background: '#630826', color: '#FDFAF5' }}
          >
            {dict['notFound.cta']}
          </Link>
          <Link
            href="/support"
            className="text-sm transition hover:opacity-80"
            style={{ color: '#8B6F4E', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
          >
            {dict['notFound.lost']}
          </Link>
        </div>
      </div>
    </div>
  )
}
