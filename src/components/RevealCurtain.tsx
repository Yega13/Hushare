'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'

// The moment a scheduled album unlocks.
//
// Until now the countdown simply vanished and a skeleton appeared — the one instant in the whole
// product with genuine anticipation behind it, spent on a layout shift. Two panels now part like
// curtains and hand the album over.
//
// Built in CSS rather than with a motion library. The whole animation is two transforms and two
// opacities; adding ~50KB of JavaScript to the album route — the hot path every guest loads on a
// phone at an event — to express that would be a bad trade, and this codebase already pays careful
// attention to what reaches that page.
//
// SEQUENCING matters here. The curtain covers the screen the instant the countdown ends, and only
// then does the album start loading behind it. Parting is deliberately delayed past the point where
// a fetch normally completes, so what appears behind the curtain is the album rather than a
// skeleton. If the fetch is slower than that, the guest sees a loading state — which is honest, and
// still better than the abrupt swap this replaces.

const HOLD_MS = 450      // curtain closed while the album loads behind it
const PART_MS = 1100     // the parting itself
const FADE_MS = 260      // the last of the panels fading out once they are off-screen

const WINE = '#630826'

export default function RevealCurtain({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<'closed' | 'parting' | 'gone'>('closed')
  const doneRef = useRef(onDone)
  useEffect(() => { doneRef.current = onDone }, [onDone])

  useEffect(() => {
    // Someone who asked for less motion gets the album, not a performance. The unlock still
    // happens; it simply does not take a second and a half to say so.
    const reduced = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      doneRef.current()
      return
    }

    const t1 = setTimeout(() => setPhase('parting'), HOLD_MS)
    const t2 = setTimeout(() => setPhase('gone'), HOLD_MS + PART_MS)
    // Unmounted by the parent only after the panels are fully clear, so nothing ever pops.
    const t3 = setTimeout(() => doneRef.current(), HOLD_MS + PART_MS + FADE_MS)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])

  const parted = phase !== 'closed'

  // Panels are TRANSFORMED, never resized: width/left animations run on the main thread and judder
  // on a mid-range phone, which is exactly the device this plays on at an event.
  const panel: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '51%',   // 1% overlap so no hairline of background shows down the seam
    background: WINE,
    // A long, slow ease-out: curtains have weight, and a linear slide reads as a wipe rather than
    // something opening.
    transition: `transform ${PART_MS}ms cubic-bezier(0.65, 0, 0.35, 1), opacity ${FADE_MS}ms linear`,
    willChange: 'transform',
    opacity: phase === 'gone' ? 0 : 1,
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        overflow: 'hidden',
        // Never traps a tap: the album behind is live the whole time.
        pointerEvents: 'none',
      }}
    >
      <div style={{ ...panel, left: 0, transform: parted ? 'translateX(-101%)' : 'translateX(0)' }} />
      <div style={{ ...panel, right: 0, transform: parted ? 'translateX(101%)' : 'translateX(0)' }} />

      {/* The mark sits on the seam and leaves early — it belongs to the closed state, and holding it
          while the panels travel would drag the eye away from what is being revealed. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: parted ? 0 : 1,
          transform: parted ? 'scale(1.06)' : 'scale(1)',
          transition: `opacity 340ms ease-out, transform ${PART_MS}ms cubic-bezier(0.65, 0, 0.35, 1)`,
        }}
      >
        <Image
          src="/logo/logo-light-transparent.png"
          alt=""
          width={618}
          height={146}
          priority
          style={{ width: 'min(46vw, 260px)', height: 'auto' }}
        />
      </div>
    </div>
  )
}
