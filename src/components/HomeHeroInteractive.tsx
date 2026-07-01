'use client'

import { useEffect, useState } from 'react'
import type { PointerEvent } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'

const ALBUM_PLACEHOLDERS = [
  'Wedding in Yerevan',
  'Maya birthday night',
  'Summer in Tuscany',
  'Aram and Ani wedding',
  'Family weekend in Dilijan',
  'Graduation of Narek',
  'Friends trip to Sevan',
]

export default function HomeHeroInteractive() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [albumPlaceholder, setAlbumPlaceholder] = useState(ALBUM_PLACEHOLDERS[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setAlbumPlaceholder(ALBUM_PLACEHOLDERS[Math.floor(Math.random() * ALBUM_PLACEHOLDERS.length)])
  }, [])

  function tiltCard(event: PointerEvent<HTMLElement>) {
    if (window.matchMedia('(max-width: 1023px)').matches) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width - 0.5
    const y = (event.clientY - rect.top) / rect.height - 0.5
    event.currentTarget.style.setProperty('--hush-tilt-y', `${x * 9}deg`)
    event.currentTarget.style.setProperty('--hush-tilt-x', `${y * -9}deg`)
  }

  function resetTiltCard(event: PointerEvent<HTMLElement>) {
    event.currentTarget.style.setProperty('--hush-tilt-x', '0deg')
    event.currentTarget.style.setProperty('--hush-tilt-y', '0deg')
  }

  async function createAlbum() {
    if (loading) return
    if (!title.trim()) { setError('Please give your album a name'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/album/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() }),
      })
      const body = await res.json().catch(() => ({})) as { slug?: string; owner_token?: string; error?: string }
      if (!res.ok || !body.slug) {
        setError(body.error ?? 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }
      // Redirect via the #owner= management link so the creator lands in owner view. Public
      // album URLs are guest-only, so the owner cookie alone no longer grants the owner view —
      // the token in the hash does. The album page strips it from the URL after owner-login.
      router.push(body.owner_token ? `/${body.slug}#owner=${body.owner_token}` : `/${body.slug}`)
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="hush-container hush-home-grid hush-fade-up relative z-10 pt-10 pb-14 lg:pt-16 lg:pb-24 grid grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(520px,1.1fr)] gap-10 lg:gap-16 2xl:gap-24 items-center lg:min-h-[calc(100vh_-_73px)]">

      <div className="hush-home-main">
        <p
          className="hush-home-eyebrow text-xs sm:text-sm font-medium uppercase mb-4 sm:mb-5 text-[#F3E0BC] lg:text-[#8B6F4E]"
          style={{ letterSpacing: '0.15em' }}
        >
          No account - No friction
        </p>
        <h1
          className="hush-home-title text-[#FDFAF5] lg:text-[#254F22] [text-shadow:0_2px_18px_rgba(0,0,0,0.35)] lg:[text-shadow:none]"
          style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(2rem, 7vw, 5.4rem)', lineHeight: 1.05, fontWeight: 700, marginBottom: '1.25rem' }}
        >
          Every moment,<br />
          <em className="text-[#F3E0BC] lg:text-[#7C4A2D]">beautifully kept</em>
        </h1>
        <p
          className="hush-home-copy text-base sm:text-lg leading-relaxed mb-8 sm:mb-10 text-[#FBF4E4] lg:text-[#6B5A4E] [text-shadow:0_1px_10px_rgba(0,0,0,0.35)] lg:[text-shadow:none]"
          style={{ maxWidth: '420px' }}
        >
          Create a shared album and let anyone add photos with just a link - no sign-up, no app download.
        </p>

        <div className="hush-album-create-card rounded-2xl hush-fluid-card" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', boxShadow: '0 4px 32px rgba(37,79,34,0.10)', maxWidth: '430px' }}>
          <label className="block text-sm font-medium mb-2" style={{ color: '#8B6F4E' }}>
            Name your album
          </label>
          <input
            type="text"
            placeholder={albumPlaceholder}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createAlbum()}
            className="hush-home-input w-full rounded-xl px-4 py-3 mb-3 focus:outline-none transition text-base"
            style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
            maxLength={120}
          />
          {error && <p className="text-sm mb-3" style={{ color: '#C0392B' }}>{error}</p>}
          <button
            onClick={createAlbum}
            disabled={loading}
            className="hush-home-button w-full flex items-center justify-center gap-2 font-semibold rounded-xl py-3 disabled:opacity-50"
            style={{ background: '#254F22', color: '#FDFAF5' }}
          >
            {loading ? 'Creating your album...' : <>Create Album <ArrowRight className="w-4 h-4" /></>}
          </button>
          <p className="hush-home-note text-xs mt-3 text-center" style={{ color: '#B0A090' }}>
            You&apos;ll receive a private link to manage your album
          </p>
        </div>
      </div>

      <div className="hush-home-visuals relative hidden lg:flex items-center justify-center" style={{ height: 'clamp(460px, 36vw, 600px)' }}>

        {/* Top-left */}
        <div onPointerMove={tiltCard} onPointerLeave={resetTiltCard} className="hush-float-slow hush-tilt-card absolute rounded-2xl overflow-hidden shadow-2xl" style={{ ['--hush-rotate' as string]: '-5deg', top: '10%', left: '12%', width: 'clamp(160px, 11vw, 220px)', height: 'clamp(200px, 14vw, 280px)', border: '4px solid rgba(255,255,255,0.9)' }}>
          <Image src="/card1.jpg" alt="Sunlit forest trail captured on a morning hike - a Hushare album photo" fill sizes="200px" className="object-cover" draggable={false} />
          <div className="absolute inset-0 flex items-end p-3" style={{ background: 'linear-gradient(to top, rgba(37,79,34,0.6) 0%, transparent 55%)' }}>
            <span className="text-xs font-medium" style={{ color: '#FDFAF5', fontFamily: 'var(--font-serif)' }}>Morning hike</span>
          </div>
        </div>

        {/* Top-right */}
        <div onPointerMove={tiltCard} onPointerLeave={resetTiltCard} className="hush-float-slow hush-tilt-card absolute rounded-2xl overflow-hidden shadow-2xl" style={{ ['--hush-rotate' as string]: '4deg', animationDelay: '-1.8s', top: '6%', right: '14%', width: 'clamp(155px, 10.5vw, 210px)', height: 'clamp(185px, 12.5vw, 255px)', border: '4px solid rgba(255,255,255,0.9)' }}>
          <Image src="/card2.jpg" alt="Warm golden-hour landscape shared in a Hushare album" fill sizes="180px" className="object-cover" draggable={false} />
          <div className="absolute inset-0 flex items-end p-3" style={{ background: 'linear-gradient(to top, rgba(124,74,45,0.6) 0%, transparent 55%)' }}>
            <span className="text-xs font-medium" style={{ color: '#FDFAF5', fontFamily: 'var(--font-serif)' }}>Golden hour</span>
          </div>
        </div>

        {/* Center — main card */}
        <div onPointerMove={tiltCard} onPointerLeave={resetTiltCard} className="hush-float-slow hush-tilt-card absolute rounded-2xl overflow-hidden shadow-2xl" style={{ ['--hush-rotate' as string]: '1deg', animationDelay: '-3.2s', top: '42%', left: '20%', width: 'clamp(210px, 14vw, 300px)', height: 'clamp(240px, 16vw, 340px)', border: '4px solid rgba(255,255,255,0.95)', zIndex: 10 }}>
          <Image src="/card3.jpg" alt="Quiet lake at dusk - a memory kept in a shared Hushare album" fill sizes="240px" className="object-cover" draggable={false} />
          <div className="absolute inset-0 flex items-end p-3" style={{ background: 'linear-gradient(to top, rgba(27,58,107,0.6) 0%, transparent 55%)' }}>
            <span className="text-xs font-medium" style={{ color: '#FDFAF5', fontFamily: 'var(--font-serif)' }}>Lake at dusk</span>
          </div>
        </div>

        {/* Bottom-right */}
        <div onPointerMove={tiltCard} onPointerLeave={resetTiltCard} className="hush-float-slow hush-tilt-card absolute rounded-2xl overflow-hidden shadow-2xl" style={{ ['--hush-rotate' as string]: '-3deg', animationDelay: '-4.6s', bottom: '4%', right: '14%', width: 'clamp(155px, 10.5vw, 210px)', height: 'clamp(155px, 10.5vw, 210px)', border: '4px solid rgba(255,255,255,0.9)' }}>
          <Image src="/children.avif" alt="Children exploring outdoors - photo from a shared Hushare family album" fill sizes="190px" className="object-cover" draggable={false} />
          <div className="absolute inset-0 flex items-end p-3" style={{ background: 'linear-gradient(to top, rgba(139,111,78,0.6) 0%, transparent 55%)' }}>
            <span className="text-xs font-medium" style={{ color: '#FDFAF5', fontFamily: 'var(--font-serif)' }}>Little explorers</span>
          </div>
        </div>

        <div className="absolute rounded-2xl px-4 py-3 shadow-xl" style={{ top: '62%', right: '10%', background: 'rgba(255,255,255,0.92)', border: '1px solid rgba(221,213,197,0.8)', zIndex: 20, backdropFilter: 'blur(8px)' }}>
          <p className="text-xs font-semibold" style={{ color: '#254F22' }}>12 photos added</p>
          <p className="text-xs" style={{ color: '#8B6F4E' }}>by 5 people</p>
        </div>
      </div>
    </div>
  )
}
