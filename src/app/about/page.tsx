import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { Heart, Zap, Shield, Mail, Phone } from 'lucide-react'
import AccountNavLink from '@/components/AccountNavLink'
import HamburgerMenu from '@/components/HamburgerMenu'
import { Globe3DLazy } from '@/components/ui/Globe3DLazy'

const GLOBE_MARKERS = [
  { lat: 40.1792, lng:   44.4991, label: 'Armenia'       },
  { lat: 37.0902, lng:  -95.7129, label: 'United States' },
  { lat: 56.1304, lng: -106.3468, label: 'Canada'        },
  { lat: 44.4268, lng:   26.1025, label: 'Romania'       },
  { lat: 49.8153, lng:    6.1296, label: 'Luxembourg'    },
  { lat: 55.7558, lng:   37.6173, label: 'Russia'        },
]

export const runtime = 'nodejs'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'

const PAGE_DESCRIPTION =
  'Hushare was built in Yerevan, Armenia because memories deserve better than a group chat. One link, highest quality, real-time — built with love.'

export const metadata: Metadata = {
  title: 'About',
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/about' },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/about`,
    title: 'About - Hushare',
    description: PAGE_DESCRIPTION,
    siteName: 'Hushare',
    locale: 'en_US',
    images: [{ url: '/wedding.jpg', width: 700, height: 1052, alt: 'Hushare - built in Yerevan, Armenia' }],
  },
  twitter: {
    card: 'summary',
    title: 'About - Hushare',
    description: PAGE_DESCRIPTION,
  },
}

export default function AboutPage() {
  return (
    <main style={{ background: '#FDFAF5', fontFamily: 'var(--font-sans)' }} className="min-h-screen">

      {/* Nav */}
      <nav
        className="hush-nav sticky top-0 z-50 flex items-center justify-between"
        style={{
          background: 'rgba(253, 250, 245, 0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(221, 213, 197, 0.5)',
        }}
      >
        <Link href="/" className="flex items-center" aria-label="Hushare home">
          <Image
            src="/logo/logo-dark-transparent.png"
            alt="Hushare"
            width={618}
            height={146}
            className="hush-logo"
            style={{ width: 'auto' }}
            draggable={false}
          />
        </Link>
        <HamburgerMenu>
          <Link href="/pricing" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>Pricing</Link>
          <span className="text-sm font-semibold underline underline-offset-4" style={{ color: '#254F22' }}>About</span>
          <Link href="/collabs" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>Collabs</Link>
          <Link href="/support" className="text-sm font-medium hover:underline" style={{ color: '#254F22' }}>Support</Link>
          <AccountNavLink />
        </HamburgerMenu>
      </nav>

      {/* Hero */}
      <section className="hush-container pt-16 pb-12 md:pt-24 md:pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">

          {/* Left — text */}
          <div>
            <p
              className="text-xs uppercase font-semibold mb-5"
              style={{ color: '#8B6F4E', letterSpacing: '0.22em' }}
            >
              Since April 2026 · Yerevan, Armenia
            </p>
            <h1
              style={{
                fontFamily: 'var(--font-serif)',
                fontStyle: 'italic',
                color: '#254F22',
                fontSize: 'clamp(2.4rem, 4.5vw, 4rem)',
                lineHeight: 1.07,
                fontWeight: 700,
              }}
            >
              Built because your memories deserve a real home.
            </h1>
            <div className="mt-6 h-px w-16" style={{ background: '#C4A678' }} />
            <p
              className="mt-6 leading-relaxed"
              style={{ color: '#6B5A4E', fontSize: 'clamp(1rem, 1.4vw, 1.15rem)', maxWidth: '34rem' }}
            >
              Not a group chat. Not a shared drive nobody checks. A real, lasting album — the kind your parents kept, rebuilt for today.
            </p>
          </div>

          {/* Right — photo */}
          <div className="flex justify-center lg:justify-end">
            <div
              className="hush-float-slow relative bg-white"
              style={{
                width: 'clamp(260px, 38vw, 420px)',
                padding: '14px 14px 60px 14px',
                transform: 'rotate(2.5deg)',
                boxShadow: '0 24px 60px rgba(37,79,34,0.18), 0 4px 12px rgba(37,79,34,0.1)',
                '--hush-rotate': '2.5deg',
              } as React.CSSProperties}
            >
              {/* tape */}
              <div
                className="absolute -top-3 left-1/2"
                style={{
                  width: '72px',
                  height: '24px',
                  background: 'rgba(196, 152, 96, 0.42)',
                  transform: 'translateX(-50%) rotate(-2deg)',
                  borderRadius: '1px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}
              />
              <div
                className="relative overflow-hidden"
                style={{ aspectRatio: '4/5', background: '#F5F0E8' }}
              >
                <Image
                  src="/wedding.jpg"
                  alt="A moment worth keeping"
                  fill
                  sizes="(max-width: 1024px) 80vw, 38vw"
                  className="object-cover"
                  priority
                  draggable={false}
                />
              </div>
              <div className="absolute bottom-4 left-0 right-0 text-center">
                <span
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontStyle: 'italic',
                    color: '#7C4A2D',
                    fontSize: '1.05rem',
                  }}
                >
                  &ldquo;Keep it.&rdquo;
                </span>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Divider */}
      <div className="hush-container pb-12">
        <div className="flex items-center gap-6">
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
          <p className="text-sm italic" style={{ color: '#B0A090', fontFamily: 'var(--font-serif)', whiteSpace: 'nowrap' }}>our story</p>
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
        </div>
      </div>

      {/* Story */}
      <section className="hush-readable pb-20">
        <div
          className="hush-reveal relative p-8 md:p-12"
          style={{
            background: 'rgba(253, 248, 237, 0.97)',
            border: '1px solid rgba(196, 166, 120, 0.35)',
            boxShadow: '0 14px 48px rgba(20, 30, 15, 0.11)',
            transform: 'rotate(-0.5deg)',
            borderRadius: '4px',
          }}
        >
          {/* tape strips */}
          <div
            className="absolute -top-3 left-14"
            style={{
              width: '72px', height: '22px',
              background: 'rgba(196, 152, 96, 0.42)',
              transform: 'rotate(-2.5deg)',
              borderRadius: '1px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
          />
          <div
            className="absolute -top-3 right-16"
            style={{
              width: '58px', height: '22px',
              background: 'rgba(120, 150, 110, 0.38)',
              transform: 'rotate(2deg)',
              borderRadius: '1px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
          />

          <p
            className="text-xs uppercase font-semibold mb-6"
            style={{ color: '#8B6F4E', letterSpacing: '0.2em' }}
          >
            Why we built this
          </p>

          <p
            className="mb-5"
            style={{
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
              color: '#254F22',
              fontSize: 'clamp(1.1rem, 1.8vw, 1.3rem)',
              lineHeight: 1.65,
            }}
          >
            &ldquo;My parents had a photo album. A real one — printed photos, carefully placed, labelled in pen. Every time we opened it, there was a whole story inside.&rdquo;
          </p>

          <p className="text-base leading-relaxed mb-4" style={{ color: '#5C4A3C' }}>
            I always wanted the same thing for my generation. But I was always too lazy to print photos, too busy to organize them, and completely overwhelmed by how many steps it takes to go from &ldquo;a bunch of photos on everyone&apos;s phones&rdquo; to &ldquo;a real album everyone can look back on.&rdquo;
          </p>

          <p className="text-base leading-relaxed mb-4" style={{ color: '#5C4A3C' }}>
            So I built Hushare. One name, one link — and every photo from everyone who was there, at the highest quality, in real time. No app to download, no account to create, no group chat chaos.
          </p>

          <p className="text-base leading-relaxed" style={{ color: '#5C4A3C' }}>
            It&apos;s been two months. We launched in April. We&apos;re still building, still growing, still obsessing over every detail. But the idea hasn&apos;t changed since day one: your memories should be easy to keep and beautiful to look back on.
          </p>

          <div className="mt-8 h-px w-12" style={{ background: '#C4A678' }} />
          <p
            className="mt-4 text-sm italic"
            style={{ color: '#7C4A2D', fontFamily: 'var(--font-serif)' }}
          >
            — with love, from Yerevan
          </p>
        </div>
      </section>

      {/* Divider */}
      <div className="hush-container pb-12">
        <div className="flex items-center gap-6">
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
          <p className="text-sm italic" style={{ color: '#B0A090', fontFamily: 'var(--font-serif)', whiteSpace: 'nowrap' }}>what we stand for</p>
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
        </div>
      </div>

      {/* Values */}
      <section className="hush-container pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {([
            {
              icon: <Heart className="w-5 h-5" />,
              accent: '#7C4A2D',
              bg: '#FBF4E4',
              border: 'rgba(196, 166, 120, 0.4)',
              title: 'Comfortable',
              desc: 'No account. No app. No friction. Just one link — and everyone is in.',
              delay: '0ms',
            },
            {
              icon: <Shield className="w-5 h-5" />,
              accent: '#254F22',
              bg: '#F0F6EE',
              border: 'rgba(37, 79, 34, 0.2)',
              title: 'Safe',
              desc: 'Albums are unlisted, link-protected, and never indexed. Your memories stay yours.',
              delay: '90ms',
            },
            {
              icon: <Zap className="w-5 h-5" />,
              accent: '#1B3A6B',
              bg: '#EEF2F9',
              border: 'rgba(27, 58, 107, 0.18)',
              title: 'Connected',
              desc: 'One album. Everyone who was there. No matter which phone, which country, which carrier.',
              delay: '180ms',
            },
          ] as const).map((v) => (
            <div
              key={v.title}
              className="hush-reveal hush-hover-lift p-7 rounded-2xl"
              style={{
                background: v.bg,
                border: `1px solid ${v.border}`,
                boxShadow: '0 4px 20px rgba(37,79,34,0.07)',
                animationDelay: v.delay,
              }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-5"
                style={{ background: v.accent, color: '#FDFAF5' }}
              >
                {v.icon}
              </div>
              <h3 className="font-semibold text-lg mb-2" style={{ color: v.accent }}>{v.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: '#6B5A4E' }}>{v.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Divider */}
      <div className="hush-container pb-12">
        <div className="flex items-center gap-6">
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
          <p className="text-sm italic" style={{ color: '#B0A090', fontFamily: 'var(--font-serif)', whiteSpace: 'nowrap' }}>what we&apos;ve built</p>
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
        </div>
      </div>

      {/* Features */}
      <section className="hush-container pb-24">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {([
            {
              title: 'Face Recognition AI',
              desc: 'Find yourself in every photo instantly. Our AI scans the whole album and surfaces your moments without scrolling forever.',
              tag: 'Live',
              tagColor: '#254F22',
              tagBg: '#E4F0E2',
              delay: '0ms',
            },
            {
              title: 'Full Album Customization',
              desc: 'Your own background, your colors, your layout. Albums look the way you want — not the way a template decided.',
              tag: 'Live',
              tagColor: '#254F22',
              tagBg: '#E4F0E2',
              delay: '70ms',
            },
            {
              title: 'Highest Quality, Always',
              desc: 'No compression. No trade-offs. Photos and videos are stored and downloaded at the exact quality they were shot in.',
              tag: 'Live',
              tagColor: '#254F22',
              tagBg: '#E4F0E2',
              delay: '140ms',
            },
            {
              title: 'AI Photo Recovery',
              desc: "Blurry shot? Bad lighting? We're building AI tools to recover and enhance photos right inside your album.",
              tag: 'Coming soon',
              tagColor: '#7C4A2D',
              tagBg: '#F9EDD8',
              delay: '210ms',
            },
          ] as const).map((f) => (
            <div
              key={f.title}
              className="hush-reveal hush-hover-lift p-6 rounded-2xl"
              style={{
                background: '#FFFFFF',
                border: '1px solid #E8E0D0',
                boxShadow: '0 4px 16px rgba(37,79,34,0.05)',
                animationDelay: f.delay,
              }}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <h3 className="font-semibold" style={{ color: '#254F22' }}>{f.title}</h3>
                <span
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full flex-none"
                  style={{ color: f.tagColor, background: f.tagBg }}
                >
                  {f.tag}
                </span>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: '#6B5A4E' }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Divider */}
      <div className="hush-container pb-12">
        <div className="flex items-center gap-6">
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
          <p className="text-sm italic" style={{ color: '#B0A090', fontFamily: 'var(--font-serif)', whiteSpace: 'nowrap' }}>what&apos;s next</p>
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
        </div>
      </div>

      {/* What's next */}
      <section className="hush-readable pb-24">
        <div
          className="hush-reveal relative overflow-hidden rounded-[20px] px-8 md:px-12 py-12"
          style={{ background: '#1B2E1A', boxShadow: '0 20px 56px rgba(10,20,10,0.22)' }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(rgba(255,240,200,0.4) 1px, transparent 1px)',
              backgroundSize: '3px 3px',
              opacity: 0.06,
            }}
          />

          <p
            className="relative z-10 text-xs uppercase font-semibold mb-4"
            style={{ color: 'rgba(253,250,245,0.4)', letterSpacing: '0.22em' }}
          >
            On the horizon
          </p>

          <h2
            className="relative z-10 mb-2"
            style={{
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
              color: '#FDFAF5',
              fontSize: 'clamp(1.6rem, 3vw, 2.2rem)',
              fontWeight: 700,
              lineHeight: 1.15,
            }}
          >
            We&apos;re two months old. We&apos;re just getting started.
          </h2>

          <p
            className="relative z-10 mb-10 text-sm leading-relaxed"
            style={{ color: 'rgba(253,250,245,0.55)', maxWidth: '32rem' }}
          >
            Here&apos;s what&apos;s coming — some of it we can talk about, some of it we can&apos;t yet.
          </p>

          <div className="relative z-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {([
              {
                label: 'AI Photo Recovery',
                desc: 'Restore blurry, dark, or damaged shots right inside your album. No Photoshop needed.',
                status: 'In progress',
                statusColor: '#C4A678',
                statusBg: 'rgba(196,166,120,0.12)',
              },
              {
                label: 'Something big.',
                desc: "We're building features we're not ready to announce yet. Follow us — you'll know when it's ready.",
                status: 'Secret',
                statusColor: '#9AB89A',
                statusBg: 'rgba(154,184,154,0.1)',
              },
              {
                label: 'Something bigger.',
                desc: 'Two months in and we already have plans that felt impossible at the start. Stay close.',
                status: 'Secret',
                statusColor: '#9AB89A',
                statusBg: 'rgba(154,184,154,0.1)',
              },
            ] as const).map((item) => (
              <div
                key={item.label}
                className="rounded-2xl p-5"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{ color: item.statusColor, background: item.statusBg }}
                  >
                    {item.status}
                  </span>
                </div>
                <h3 className="font-semibold mb-2" style={{ color: '#FDFAF5', fontSize: '0.95rem' }}>
                  {item.label}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(253,250,245,0.5)' }}>
                  {item.desc}
                </p>
              </div>
            ))}
          </div>

          <p
            className="relative z-10 mt-8 text-sm italic"
            style={{ color: 'rgba(253,250,245,0.3)', fontFamily: 'var(--font-serif)' }}
          >
            Follow <a href="https://www.instagram.com/hushare_space/" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(253,250,245,0.55)', textDecoration: 'underline' }}>@hushare_space</a> to be the first to know.
          </p>
        </div>
      </section>

      {/* Divider */}
      <div className="hush-container pb-12">
        <div className="flex items-center gap-6">
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
          <p className="text-sm italic" style={{ color: '#B0A090', fontFamily: 'var(--font-serif)', whiteSpace: 'nowrap' }}>our community</p>
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
        </div>
      </div>

      {/* Globe */}
      <section className="hush-container pb-24">
        <div
          className="hush-reveal relative rounded-[20px] overflow-hidden"
          style={{ background: '#1B2E1A', boxShadow: '0 20px 56px rgba(10,20,10,0.22)' }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(rgba(255,240,200,0.4) 1px, transparent 1px)',
              backgroundSize: '3px 3px',
              opacity: 0.06,
            }}
          />

          <div className="relative z-10 pt-12 pb-2 px-8 md:px-12 text-center">
            <p
              className="text-xs uppercase font-semibold mb-4"
              style={{ color: 'rgba(253,250,245,0.4)', letterSpacing: '0.22em' }}
            >
              Our community
            </p>
            <h2
              style={{
                fontFamily: 'var(--font-serif)',
                fontStyle: 'italic',
                color: '#FDFAF5',
                fontSize: 'clamp(1.5rem, 2.5vw, 2rem)',
                fontWeight: 700,
                lineHeight: 1.15,
                marginBottom: '0.75rem',
              }}
            >
              A small team. A growing community.
            </h2>
            <p
              className="text-sm"
              style={{ color: 'rgba(253,250,245,0.5)', maxWidth: '30rem', margin: '0 auto' }}
            >
              From Yerevan to the world — our users are in Armenia, USA, Canada, Romania, Luxembourg, and Russia.
            </p>
          </div>

          <div className="relative z-10 mx-auto" style={{ maxWidth: '400px', padding: '1.5rem 2rem 2.5rem' }}>
            <Globe3DLazy
              markers={GLOBE_MARKERS}
              config={{
                atmosphereColor:     '#4da6ff',
                atmosphereIntensity: 20,
                bumpScale:           5,
                autoRotateSpeed:     0.2,
              }}
            />
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="hush-container-xl mb-24">
        <div
          className="hush-reveal relative rounded-[24px] px-8 md:px-16 py-14 text-center overflow-hidden"
          style={{ background: '#1B2E1A', boxShadow: '0 24px 60px rgba(10,20,10,0.28)' }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(rgba(255,240,200,0.5) 1px, transparent 1px)',
              backgroundSize: '3px 3px',
              opacity: 0.06,
            }}
          />

          <p
            className="relative z-10 text-xs uppercase font-semibold mb-4"
            style={{ color: 'rgba(253,250,245,0.5)', letterSpacing: '0.22em' }}
          >
            Find us
          </p>

          <h2
            className="relative z-10"
            style={{
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
              color: '#FDFAF5',
              fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)',
              fontWeight: 700,
              lineHeight: 1.15,
              marginBottom: '2rem',
            }}
          >
            We&apos;re always happy to hear from you.
          </h2>

          <div className="relative z-10 flex items-center justify-center gap-3 flex-wrap mb-8">
            <a
              href="https://www.instagram.com/hushare_space/"
              target="_blank"
              rel="noopener noreferrer"
              className="hush-press flex items-center gap-2.5 px-6 py-3 rounded-full font-semibold text-sm"
              style={{ background: '#FDFAF5', color: '#254F22' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect width="20" height="20" x="2" y="2" rx="5" ry="5"/>
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                <line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>
              </svg>
              @hushare_space
            </a>
            <a
              href="https://www.tiktok.com/@hushare_space"
              target="_blank"
              rel="noopener noreferrer"
              className="hush-press flex items-center gap-2.5 px-6 py-3 rounded-full font-semibold text-sm"
              style={{ background: '#FDFAF5', color: '#254F22' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z"/>
              </svg>
              @hushare_space
            </a>
          </div>

          <div className="relative z-10 flex items-center gap-4 mb-6 max-w-xs mx-auto">
            <div className="flex-1 h-px" style={{ background: 'rgba(253,250,245,0.15)' }} />
            <span className="text-xs" style={{ color: 'rgba(253,250,245,0.35)', letterSpacing: '0.1em' }}>or reach us directly</span>
            <div className="flex-1 h-px" style={{ background: 'rgba(253,250,245,0.15)' }} />
          </div>

          <div className="relative z-10 flex flex-col sm:flex-row items-center justify-center gap-5 sm:gap-10">
            <a href="mailto:husharesupport@gmail.com" className="flex items-center gap-2.5 hover:opacity-80 transition">
              <Mail className="w-4 h-4 flex-none" style={{ color: 'rgba(253,250,245,0.5)' }} />
              <span className="text-sm font-medium" style={{ color: 'rgba(253,250,245,0.75)' }}>
                husharesupport@gmail.com
              </span>
            </a>
            <a href="tel:+37496371135" className="flex items-center gap-2.5 hover:opacity-80 transition">
              <Phone className="w-4 h-4 flex-none" style={{ color: 'rgba(253,250,245,0.5)' }} />
              <span className="text-sm font-medium" style={{ color: 'rgba(253,250,245,0.75)' }}>
                +374 96 37 11 35
              </span>
            </a>
          </div>

          <p
            className="relative z-10 mt-10 text-sm italic"
            style={{ color: 'rgba(253,250,245,0.4)', fontFamily: 'var(--font-serif)' }}
          >
            Made with love in Yerevan, Armenia
          </p>
        </div>
      </section>

    </main>
  )
}
