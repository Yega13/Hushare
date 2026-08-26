import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { getServerLocale } from '@/i18n/server'
import { getDictionary } from '@/i18n/get-dictionary'

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
// The picture is three EMPTY FRAMES, tilted the way photographs sit when they have been put down in
// a pile. It says "the album is not here" in the product's own vocabulary, and it is drawn entirely
// in CSS: no illustration to load, nothing for the CSP to block, nothing to go missing on the exact
// page whose whole job is to work when something else did not.
//
// Reduced motion is handled globally in styles/base.css, which flattens every animation and
// transition — so the drift below simply does not run, and the frames sit still.

const FRAMES = [
  { rotate: -9, x: -74, y: 10, delay: '0s', z: 1 },
  { rotate: 7, x: 74, y: 16, delay: '.9s', z: 2 },
  // Drawn last and centred, so the front frame of the pile is the one that reads first.
  { rotate: -2, x: 0, y: 0, delay: '.45s', z: 3 },
]

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

        {/* The pile of empty frames. Purely decorative — a screen reader gets the heading below,
            which says the same thing in words. */}
        <div
          aria-hidden="true"
          style={{ position: 'relative', width: '100%', height: 150, marginBottom: 4 }}
        >
          {FRAMES.map((frame) => (
            <span
              key={frame.z}
              className="hush-404-frame"
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: 108,
                height: 118,
                marginLeft: -54,
                marginTop: -59,
                zIndex: frame.z,
                borderRadius: 10,
                background: 'rgba(255, 253, 248, 0.92)',
                border: '1px solid #E3D6C0',
                boxShadow: '0 10px 26px rgba(99, 8, 38, 0.10)',
                // Custom properties so one keyframe can drive all three: the animation adds its
                // drift on top of each frame's own resting position instead of overwriting it.
                ['--x' as string]: `${frame.x}px`,
                ['--y' as string]: `${frame.y}px`,
                ['--r' as string]: `${frame.rotate}deg`,
                animationDelay: frame.delay,
              }}
            >
              {/* The empty window inside the mount, dashed to read as "nothing here yet" rather
                  than as a photo that failed to load. */}
              <span
                style={{
                  position: 'absolute',
                  inset: '9px 9px 24px',
                  borderRadius: 5,
                  border: '1px dashed #DCCBB0',
                  background:
                    'linear-gradient(135deg, rgba(243,224,188,0.20) 0%, rgba(243,224,188,0.05) 100%)',
                }}
              />
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
          50% { transform: translate(var(--x), calc(var(--y) - 7px)) rotate(calc(var(--r) * 0.82)); }
        }
      `}</style>
    </div>
  )
}
