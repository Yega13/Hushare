import Image from 'next/image'
import Link from 'next/link'
import AccountNavLink from '@/components/AccountNavLink'
import HamburgerMenu from '@/components/HamburgerMenu'
import FaqList from '@/components/FaqList'
import HomeHeroInteractive from '@/components/HomeHeroInteractive'
import HomeScrollButton from '@/components/HomeScrollButton'
import MyDeviceAlbums from '@/components/MyDeviceAlbums'

const NATURE_IMG = '/hero-nature.jpg'

const homeFaq = [
  {
    q: 'Do guests need an account to add photos?',
    a: (
      <>
        No. Anyone with your album link can view and add photos - <strong className="font-semibold" style={{ color: '#630826' }}>no sign-up</strong>, no app, no download. Hushare is designed so the only friction between a guest and the album is tapping the link.
      </>
    ),
  },
  {
    q: 'How long does Hushare keep my photos?',
    a: (
      <>
        Free albums are preserved as long as they remain active. If an album sits untouched for <strong className="font-semibold" style={{ color: '#630826' }}>3 months</strong>, it is automatically retired and its media is deleted (we email you a warning first so you can download everything). Paid tiers remove this inactivity rule, and keep your albums for a year even after you cancel.
      </>
    ),
  },
  {
    q: 'Is Hushare really free?',
    a: (
      <>
        Yes. Free albums are free to create, share, upload to, and download from, with no credit card required. Paid tiers add custom URLs, passwords, larger uploads, Studio Collections, and no inactivity retirement.
      </>
    ),
  },
  {
    q: 'Can I customize how an album looks?',
    a: (
      <>
        Yes. Owners can choose a background color, a stock photo background, or upload their own background image from album settings. Saved backgrounds are part of the album, so guests see the same look.
      </>
    ),
  },
  {
    q: 'What are Collections?',
    a: (
      <>
        Collections are Studio-only pages that group several albums under one public link, useful for photographers, event planners, or families managing related albums.
      </>
    ),
  },
  {
    q: 'Can I use a QR code at a wedding or event?',
    a: (
      <>
        Yes. Every album has a unique link you can turn into a <strong className="font-semibold" style={{ color: '#630826' }}>QR code</strong> and print on table cards, invitations, programs, or a welcome sign. Guests scan it and start adding photos instantly.
      </>
    ),
  },
  {
    q: 'Can I download all the photos at once?',
    a: (
      <>
        Yes. From the owner view of your album, you can download the full collection as a single <strong className="font-semibold" style={{ color: '#630826' }}>ZIP</strong> file - <strong className="font-semibold" style={{ color: '#630826' }}>originals</strong>, not compressed thumbnails.
      </>
    ),
  },
  {
    q: 'Who can see my album?',
    a: (
      <>
        Only people with the link. Albums are <strong className="font-semibold" style={{ color: '#630826' }}>unlisted</strong> - they are not indexed by search engines and cannot be discovered by browsing the site. Share the link only with the people you want to invite.
      </>
    ),
  },
  {
    q: 'What happens if I lose my owner link?',
    a: (
      <>
        The owner link is how Hushare recognises you as the album creator. <strong className="font-semibold" style={{ color: '#630826' }}>Bookmark it</strong> as soon as you create an album, or forward it to yourself. If you do lose it, contact us with your album name and approximate creation date and we will verify you manually.
      </>
    ),
  },
  {
    q: 'What photo formats and sizes are supported?',
    a: (
      <>
        Free albums support JPG, PNG, HEIC, and WebP images up to <strong className="font-semibold" style={{ color: '#630826' }}>25 MB</strong> each, plus MP4, MOV, or WebM videos up to <strong className="font-semibold" style={{ color: '#630826' }}>50 MB</strong>. Pro albums raise this to <strong className="font-semibold" style={{ color: '#630826' }}>200 MB</strong> photos and <strong className="font-semibold" style={{ color: '#630826' }}>1 GB</strong> HD video (Studio up to 4 GB).
      </>
    ),
  },
]

export default function HomePage() {
  return (
    <main style={{ background: '#FDFAF5', fontFamily: 'var(--font-sans)' }} className="min-h-screen">

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
          <Link href="/pricing" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>
            Pricing
          </Link>
          <Link href="/about" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>
            About
          </Link>
          <Link href="/collabs" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>
            Collabs
          </Link>
          <Link href="/support" className="text-sm font-medium hover:underline" style={{ color: '#630826' }}>
            Support
          </Link>
          <AccountNavLink />
        </HamburgerMenu>
      </nav>

      <div className="hush-home-hero relative overflow-hidden lg:min-h-[calc(100vh_-_73px)]">

        <div
          className="hush-home-mobile-bg absolute inset-0 lg:hidden"
          style={{
            backgroundImage: `url(${NATURE_IMG})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(160deg, rgba(20,40,18,0.78) 0%, rgba(99,8,38,0.62) 50%, rgba(27,58,107,0.55) 100%)',
            }}
          />
        </div>

        <div
          className="hush-home-desktop-bg absolute inset-y-0 right-0 hidden lg:block lg:w-[58%]"
          style={{
            backgroundImage: `url(${NATURE_IMG})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            clipPath: 'polygon(20% 0%, 100% 0%, 100% 100%, 0% 100%)',
          }}
        >
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(99,8,38,0.45) 0%, rgba(27,58,107,0.25) 100%)' }} />
        </div>

        <div
          className="hush-home-feather absolute inset-y-0 hidden lg:block"
          style={{
            left: '36%',
            width: '130px',
            background: 'linear-gradient(to right, #FDFAF5, transparent)',
            zIndex: 2,
          }}
        />

        <HomeHeroInteractive />
      </div>

      {/* Recovery for anonymous creators — renders only if this device has saved albums */}
      <MyDeviceAlbums />

      <div className="hush-container py-12">
        <div className="flex items-center gap-6">
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
          <p className="text-sm italic" style={{ color: '#B0A090', fontFamily: 'var(--font-serif)', whiteSpace: 'nowrap' }}>how it works</p>
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
        </div>
      </div>

      <section className="hush-container pb-20 sm:pb-24 pt-4">
        <div className="hush-reveal grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8 xl:gap-12 items-start">
          {[
            {
              rot: -3.5,
              lift: 0,
              tapeColor: 'rgba(196, 152, 96, 0.45)',
              captionColor: '#7C4A2D',
              caption: '"Name it."',
              label: 'First',
              desc: 'Give your album a name. You get a private link you own - no account, no app.',
              image: '/how-it-works-1.jpg',
              alt: 'Photo card representing a newly named Hushare album',
            },
            {
              rot: 2.5,
              lift: 32,
              tapeColor: 'rgba(120, 150, 110, 0.4)',
              captionColor: '#630826',
              caption: '"Share it."',
              label: 'Then',
              desc: 'Text it, print a QR for the table, drop it in the group chat. One link, everyone in.',
              image: '/shareit.jpg',
              alt: 'Photo card representing a shared Hushare album link',
            },
            {
              rot: -1.5,
              lift: 12,
              tapeColor: 'rgba(120, 135, 170, 0.4)',
              captionColor: '#1B3A6B',
              caption: '"Keep it."',
              label: 'As long as you want',
              desc: 'Photos flow in from everyone who came. Free albums stay put - untouched for a year, they quietly retire. Active ones live on.',
              image: '/how-it-works-3.jpg',
              alt: 'Photo card representing a kept Hushare album',
            },
          ].map((step, i) => (
            <div
              key={i}
              className="flex flex-col items-center md:[margin-top:var(--lift)]"
              style={{ ['--lift' as string]: `${step.lift}px` }}
            >
              <div
                className="hush-hover-lift relative bg-white"
                style={{
                  width: 'clamp(220px, 18vw, 300px)',
                  padding: '14px 14px 56px 14px',
                  transform: `rotate(${step.rot}deg)`,
                  boxShadow: '0 18px 44px rgba(99,8,38,0.16), 0 2px 8px rgba(99,8,38,0.08)',
                }}
              >
                <div
                  className="absolute -top-3 left-1/2"
                  style={{
                    width: '64px',
                    height: '22px',
                    background: step.tapeColor,
                    transform: 'translateX(-50%) rotate(-3deg)',
                    borderRadius: '1px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                  }}
                />

                <div
                  className="relative flex items-center justify-center aspect-square overflow-hidden"
                  style={{ background: '#F5F0E8' }}
                >
                  <Image src={step.image} alt={step.alt} fill sizes="240px" className="object-cover" unoptimized draggable={false} />
                </div>

                <div className="absolute bottom-3 left-0 right-0 text-center">
                  <span
                    style={{
                      fontFamily: 'var(--font-serif)',
                      fontStyle: 'italic',
                      color: step.captionColor,
                      fontSize: '1.15rem',
                    }}
                  >
                    {step.caption}
                  </span>
                </div>
              </div>

              <div
                className="mt-8 text-center px-2"
                style={{ maxWidth: '240px', transform: `rotate(${-step.rot * 0.3}deg)` }}
              >
                <p
                  className="text-xs uppercase mb-2"
                  style={{ color: '#8B6F4E', letterSpacing: '0.18em', fontWeight: 600 }}
                >
                  {step.label}
                </p>
                <p className="text-sm leading-relaxed" style={{ color: '#6B5A4E' }}>
                  {step.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="hush-container pt-10 pb-12">
        <div className="flex items-center gap-6">
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
          <p
            style={{
              color: '#630826',
              fontFamily: 'var(--font-serif)',
              fontSize: '1.75rem',
              fontWeight: 700,
              letterSpacing: '0.25em',
              whiteSpace: 'nowrap',
              lineHeight: 1,
            }}
          >
            FAQ
          </p>
          <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
        </div>
      </div>

      <section className="hush-readable pb-24">
        <div
          className="hush-reveal rounded-[8px] px-6 py-4 md:px-10 md:py-6"
          style={{
            background: '#FBF4E4',
            border: '1px solid rgba(196,166,120,0.35)',
            boxShadow: '0 10px 36px rgba(99,8,38,0.08)',
            backgroundImage:
              'repeating-linear-gradient(to bottom, transparent 0, transparent 47px, rgba(196,166,120,0.15) 47px, rgba(196,166,120,0.15) 48px)',
          }}
        >
          <FaqList items={homeFaq} compactCount={6} plusSize={28} />
        </div>

        <p
          className="text-center text-sm mt-8 italic"
          style={{ color: '#8B6F4E', fontFamily: 'var(--font-serif)' }}
        >
          Still curious? Write to us at <span style={{ color: '#630826', fontWeight: 600 }}>husharesupport@gmail.com</span>
        </p>
      </section>

      <section className="hush-container-xl mb-20 relative">
        <div
          className="hush-reveal relative rounded-[28px] overflow-hidden"
          style={{
            minHeight: '440px',
            backgroundImage: 'url(/wedding.jpg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            boxShadow: '0 24px 60px rgba(99,8,38,0.22)',
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(115deg, rgba(30,45,25,0.72) 0%, rgba(55,40,30,0.55) 45%, rgba(80,50,30,0.15) 100%)',
            }}
          />

          <div
            className="absolute inset-0 opacity-[0.12] mix-blend-overlay pointer-events-none"
            style={{
              backgroundImage:
                'radial-gradient(rgba(255,240,200,0.6) 1px, transparent 1px)',
              backgroundSize: '3px 3px',
            }}
          />

          <div className="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-0 min-h-[440px]">
            <div className="md:col-span-7 flex items-center px-6 sm:px-10 md:px-14 py-14">
              <div
                className="relative max-w-lg p-8 md:p-10"
                style={{
                  background: 'rgba(253, 248, 237, 0.96)',
                  backdropFilter: 'blur(6px)',
                  border: '1px solid rgba(196, 166, 120, 0.35)',
                  boxShadow: '0 14px 40px rgba(20,30,15,0.35)',
                  transform: 'rotate(-1.2deg)',
                  borderRadius: '4px',
                }}
              >
                <div
                  className="absolute -top-3 -right-3 w-16 h-20 flex flex-col items-center justify-center"
                  style={{
                    background: '#F3E0BC',
                    border: '1.5px dashed #8B6F4E',
                    transform: 'rotate(6deg)',
                    boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
                  }}
                >
                  <Image
                    src="/logo/logo-icon-dark-transparent.png"
                    alt=""
                    width={500}
                    height={500}
                    style={{ width: '22px', height: '22px' }}
                    draggable={false}
                  />
                  <span
                    className="text-[9px] mt-1 tracking-widest uppercase"
                    style={{ color: '#7C4A2D', fontWeight: 700 }}
                  >
                    Hushare
                  </span>
                </div>

                <div
                  className="absolute -top-6 right-16 w-20 h-20 rounded-full hidden md:flex items-center justify-center opacity-60"
                  style={{
                    border: '1.5px solid #7C4A2D',
                    transform: 'rotate(-8deg)',
                  }}
                >
                  <span
                    className="text-[10px] tracking-[0.2em] uppercase"
                    style={{ color: '#7C4A2D', fontFamily: 'var(--font-serif)' }}
                  >
                    Kept - {new Date().getFullYear()}
                  </span>
                </div>

                <p
                  className="text-[11px] uppercase mb-3"
                  style={{ color: '#8B6F4E', letterSpacing: '0.22em', fontWeight: 600 }}
                >
                  To - the keeper of moments
                </p>

                <h2
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontStyle: 'italic',
                    color: '#630826',
                    fontSize: 'clamp(1.9rem, 3.4vw, 2.5rem)',
                    lineHeight: 1.15,
                    fontWeight: 700,
                  }}
                >
                  Start your first<br />shared album.
                </h2>

                <div
                  className="my-5 h-px w-16"
                  style={{ background: '#C4A678' }}
                />

                <p
                  className="text-sm leading-relaxed"
                  style={{ color: '#5C4A3C', maxWidth: '24rem' }}
                >
                  Start free. One link, any number of guests, no
                  app to install. Active albums stay available; quiet free albums retire after a year.
                </p>

                <HomeScrollButton />

                <p
                  className="mt-6 text-sm italic"
                  style={{
                    color: '#7C4A2D',
                    fontFamily: 'var(--font-serif)',
                  }}
                >
                  - with love, from Yerevan
                </p>
              </div>
            </div>

            <div className="md:col-span-5" />
          </div>
        </div>
      </section>

    </main>
  )
}
