import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { getServerLocale } from '@/i18n/server'
import { getDictionary } from '@/i18n/get-dictionary'
import { DRIFT, FRAMES, NARROW, PILE_HEIGHT, frameStyle, windowStyle } from '@/lib/not-found-frames'

export const metadata: Metadata = {
  title: 'Album not found — Hushare',
  robots: { index: false, follow: false },
}

// The 404 page, which is a real page and not a shrug.
//
// It used to be a logo, a line of text and two links on a flat background — correct, and completely
// characterless, on the one page where somebody is already disappointed. Nearly everyone who lands
// here was sent a link to somebody's wedding and got nothing.
//
// The picture is a pile of three framed beach photos, tilted the way prints sit when they have been
// put down on a table. What is in the pile, every size its parts share, and why the photos are CSS
// backgrounds rather than images all live in src/lib/not-found-frames.ts; this page only lays it out.
//
// Reduced motion is handled globally in styles/base.css, which flattens every animation and
// transition — so the drift below simply does not run, and the frames sit still.

export default async function NotFound() {
  const dict = getDictionary(await getServerLocale())
  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-6 py-16 text-center"
      style={{
        // A wash rather than a flat fill: the page has a lot of empty space by design, and a single
        // colour across all of it is what made it read as unfinished.
        background:
          'radial-gradient(120% 90% at 50% 0%, #FFFDF8 0%, #FDFAF5 42%, #F7EFE3 100%)',
      }}
    >
      <div className="flex flex-col items-center gap-8 w-full" style={{ maxWidth: '26rem' }}>
        <Link href="/" aria-label="Hushare home">
          <Image
            src="/logo/logo-dark-transparent.png"
            alt="Hushare"
            width={618}
            height={146}
            style={{ width: 'auto', maxWidth: '116px' }}
            priority
          />
        </Link>

        {/* The pile of framed photos. Purely decorative — a screen reader gets the heading below,
            which is the part that says anything. */}
        <div
          aria-hidden="true"
          className="hush-404-pile"
          style={{ position: 'relative', width: '100%', height: PILE_HEIGHT, marginBottom: 4 }}
        >
          {FRAMES.map((frame) => (
            <span key={frame.z} className="hush-404-frame" style={frameStyle(frame)}>
              <span style={windowStyle(frame.photo)} />
            </span>
          ))}
        </div>

        <div>
          <p
            className="font-semibold uppercase mb-3"
            style={{ fontSize: '11px', color: '#B98E4C', letterSpacing: '0.22em' }}
          >
            404
          </p>
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              color: '#630826',
              fontSize: 'clamp(1.7rem, 5.5vw, 2.5rem)',
              fontWeight: 700,
              lineHeight: 1.16,
            }}
          >
            {dict['notFound.title']}
          </h1>
          <p className="mt-3 text-sm" style={{ color: '#8B6F4E', lineHeight: 1.65 }}>
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
            className="hush-press rounded-xl px-6 py-3 font-semibold text-sm w-full sm:w-auto"
            style={{
              background: '#630826',
              color: '#FDFAF5',
              boxShadow: '0 8px 20px rgba(99, 8, 38, 0.22)',
            }}
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

      <style>{`
        .hush-404-frame {
          transform: translate(var(--x), var(--y)) rotate(var(--r));
          animation: hush-404-drift 9s ease-in-out infinite;
        }
        @keyframes hush-404-drift {
          0%, 100% { transform: translate(var(--x), var(--y)) rotate(var(--r)); }
          50% { transform: translate(var(--x), calc(var(--y) - ${DRIFT.lift}px)) rotate(calc(var(--r) * ${DRIFT.tiltKept})); }
        }
        ${NARROW.map((n) => `@media (max-width: ${n.maxWidth}px) { .hush-404-pile { transform: scale(${n.scale}); } }`).join(' ')}
      `}</style>
    </div>
  )
}
