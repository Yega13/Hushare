'use client'

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import { useT } from '@/i18n/LocaleProvider'

// The card someone sees the moment their payment clears.
//
// Shaped as a SEALED INVITATION rather than a dialog, because that is what this product is for —
// weddings, races, parties. A generic "Success!" panel with a green tick would be the same card
// every SaaS ships and would say nothing about what they just bought. Pressed cream stock, a gold
// rule inside the edge, and a wax seal that stamps down onto it a beat after the card lands.
//
// The stamp is the whole idea: it arrives late and slightly overshoots, the way something pressed
// into wax does. It is one keyframe and costs nothing, and it is the part people will remember.
//
// PRO is sealed in wine, MAX in gold. Same card, and the difference is felt rather than announced —
// which is more convincing than writing "premium" on it.

const WINE = '#630826'
const GOLD = '#D4AF6A'

export default function WelcomeModal({
  plan,
  features,
  onClose,
}: {
  plan: 'Pro' | 'Max'
  features: string[]
  onClose: () => void
}) {
  const { t } = useT()
  const closeRef = useRef<() => void>(onClose)
  useEffect(() => { closeRef.current = onClose })

  const cardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // TRAP TAB INSIDE THE CARD.
    //
    // aria-modal="true" is a promise to assistive technology, not a behaviour the browser
    // implements — the rest of the page stays in the tab order regardless. The card holds exactly
    // one focusable element, so a single Tab used to move focus out into the live dashboard behind
    // the scrim: the nav, then every album, then "Delete album", all reachable with Enter because a
    // scrim only stops the POINTER. A keyboard user could delete an album through a dialog claiming
    // to be modal.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeRef.current(); return }
      if (e.key !== 'Tab') return
      const card = cardRef.current
      if (!card) return
      const focusable = card.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) { e.preventDefault(); return }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      // Wrap at both ends, and pull focus back in if it has escaped already.
      if (e.shiftKey && (active === first || !card.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !card.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    // Hand focus back where it came from. Without this it falls to <body> on close and the next Tab
    // restarts from the top of the document.
    const previouslyFocused = document.activeElement as HTMLElement | null

    // Hold the page still underneath, using the lock this codebase already has rather than setting
    // body.style.overflow by hand. The class goes on BOTH html and body and carries
    // overscroll-behavior: none with it, which is what stops an iPhone rubber-banding the dashboard
    // around behind the card when you drag on it. A private second mechanism would have missed
    // that, and two things fighting over body overflow is how a page ends up permanently
    // unscrollable.
    const html = document.documentElement
    html.classList.add('hush-scroll-locked')
    document.body.classList.add('hush-scroll-locked')
    return () => {
      document.removeEventListener('keydown', onKey)
      html.classList.remove('hush-scroll-locked')
      document.body.classList.remove('hush-scroll-locked')
      previouslyFocused?.focus?.()
    }
  }, [])

  const isMax = plan === 'Max'

  // THREE fixed layers, not one, and the z-order between them is the whole reason.
  //
  // The obvious build is a single blurred backdrop with the card inside it. That backdrop blurs
  // everything painted beneath it — including the confetti, which is the celebration itself, and
  // which came out as coloured smudges. backdrop-filter only samples what is BELOW the element in
  // stacking order, so lifting the confetti above the scrim leaves it perfectly crisp while the
  // dashboard behind stays soft:
  //   9997  scrim, blurred, and the only click target that dismisses
  //   9998  confetti
  //   9999  the card
  return (
    <>
      <div
        className="hush-welcome-back"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9997,
          background: 'rgba(30, 5, 14, 0.66)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }}
      />
      {/* Transparent to the pointer, so a tap anywhere off the card reaches the scrim above. */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          pointerEvents: 'none',
        }}
      >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hush-welcome-title"
        className="hush-welcome-card"
        ref={cardRef}
        style={{
          pointerEvents: 'auto',
          position: 'relative',
          width: '100%',
          maxWidth: '440px',
          background: '#FFFEF9',
          border: '1px solid #E6D9C2',
          borderRadius: '20px',
          padding: '52px 30px 26px',
          textAlign: 'center',
          boxShadow: '0 30px 80px rgba(38,6,16,0.42)',
        }}
      >
        {/* The gold rule sits INSIDE the edge, the way it does on printed stock. Purely decorative,
            so it never intercepts a tap. */}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: '9px',
            borderRadius: '13px',
            border: `1px solid ${isMax ? 'rgba(212,175,106,0.55)' : 'rgba(139,111,78,0.34)'}`,
            pointerEvents: 'none',
          }}
        />

        {/* The seal, straddling the top edge. Positioned with `left: calc(50% - 33px)` rather than a
            translate, so the entrance keyframe owns transform outright and reduced motion can drop
            it without the seal sliding off-centre. */}
        <span
          aria-hidden="true"
          className="hush-welcome-seal"
          style={{
            position: 'absolute',
            top: '-33px',
            left: 'calc(50% - 33px)',
            width: '66px',
            height: '66px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isMax
              ? `linear-gradient(145deg, #E8C989 0%, ${GOLD} 45%, #A87F2E 100%)`
              : `linear-gradient(145deg, #7E1236 0%, ${WINE} 55%, #43061A 100%)`,
            boxShadow: isMax
              ? '0 8px 22px rgba(168,127,46,0.42), inset 0 1px 2px rgba(255,255,255,0.5)'
              : '0 8px 22px rgba(67,6,26,0.45), inset 0 1px 2px rgba(255,255,255,0.22)',
          }}
        >
          <Image
            src={isMax ? '/logo/logo-icon-dark-transparent.png' : '/logo/logo-icon-light-transparent.png'}
            alt=""
            width={500}
            height={500}
            style={{ width: '34px', height: '34px' }}
          />
        </span>

        <p
          style={{
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.2em',
            fontWeight: 600,
            color: isMax ? '#A87F2E' : '#8B6F4E',
            marginBottom: '10px',
          }}
        >
          {t('welcome.eyebrow')}
        </p>

        <h2
          id="hush-welcome-title"
          style={{
            fontSize: '30px',
            lineHeight: 1.15,
            fontWeight: 700,
            color: WINE,
            fontFamily: 'var(--font-serif)',
            marginBottom: '10px',
          }}
        >
          {t('welcome.headline', { plan })}
        </h2>

        <p style={{ fontSize: '14px', lineHeight: 1.6, color: '#5C4A3C', marginBottom: '22px' }}>
          {t(isMax ? 'welcome.bodyMax' : 'welcome.bodyPro')}
        </p>

        {/* The list is handed in by the page, which already computes it for the plan card below.
            Duplicating it here would make a second place to forget when the tiers change. */}
        <p
          style={{
            fontSize: '10px',
            textTransform: 'uppercase',
            letterSpacing: '0.16em',
            fontWeight: 600,
            color: '#8B6F4E',
            marginBottom: '10px',
          }}
        >
          {t('welcome.unlocked')}
        </p>
        {/* THE LIST IS CAPPED because it is not fixed-length. It comes from planFeatures(), which
            grows every time a feature is gated — Max went from six lines to nine in one change. The
            card has no max-height of its own (the seal straddles its top edge, so clipping the card
            would cut the seal off), and it sits in a pointer-transparent wrapper that cannot scroll,
            so a card taller than the viewport would have been clipped at BOTH ends with no way to
            reach the button. Capping the list keeps the rest of the card a known height. */}
        <ul
          style={{
            textAlign: 'left',
            marginBottom: '22px',
            display: 'grid',
            gap: '7px',
            maxHeight: 'min(42vh, 300px)',
            overflowY: 'auto',
            // Without this, reaching the end of the list scrolls the dashboard behind the scrim.
            overscrollBehavior: 'contain',
          }}
        >
          {features.map((f) => (
            <li key={f} style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', fontSize: '13.5px', color: '#3F3228' }}>
              <span aria-hidden="true" style={{ color: isMax ? '#A87F2E' : WINE, fontWeight: 700, lineHeight: 1.5 }}>&#10003;</span>
              <span style={{ lineHeight: 1.5 }}>{f}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onClose}
          autoFocus
          className="w-full font-semibold rounded-xl py-3 text-sm transition hover:opacity-90"
          style={{ background: WINE, color: '#FDFAF5' }}
        >
          {t('welcome.cta')}
        </button>

        <p style={{ fontSize: '11.5px', color: '#8B6F4E', marginTop: '13px' }}>
          {t('welcome.thanks')}
        </p>

        {/* A real close control. Tapping outside works, but that is invisible, and on a phone the
            card fills most of the screen so there is barely an outside to tap. */}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('welcome.close')}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            width: '30px',
            height: '30px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#8B6F4E',
            fontSize: '17px',
            lineHeight: 1,
          }}
        >
          &#215;
        </button>
      </div>
      </div>

      <style>{`
        .hush-welcome-back { animation: hush-welcome-fade 220ms ease-out both; }
        .hush-welcome-card { animation: hush-welcome-rise 460ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        /* Late, and it overshoots — a seal is pressed, not faded in. */
        .hush-welcome-seal { animation: hush-welcome-stamp 420ms cubic-bezier(0.3, 1.5, 0.5, 1) 300ms both; }
        @keyframes hush-welcome-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes hush-welcome-rise {
          from { opacity: 0; transform: translateY(20px) scale(0.955) }
          to   { opacity: 1; transform: none }
        }
        @keyframes hush-welcome-stamp {
          from { opacity: 0; transform: scale(2) rotate(-16deg) }
          60%  { opacity: 1 }
          to   { opacity: 1; transform: scale(1) rotate(0deg) }
        }
        @media (prefers-reduced-motion: reduce) {
          .hush-welcome-back, .hush-welcome-card, .hush-welcome-seal { animation: none }
        }
      `}</style>
    </>
  )
}
