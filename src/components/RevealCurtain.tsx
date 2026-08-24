'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'

// The moment a scheduled album unlocks.
//
// Until now the countdown simply vanished and a skeleton appeared — the one instant in the whole
// product with genuine anticipation behind it, spent on a layout shift. Two wine-red halves are now
// clipped away from the centre outwards, uncovering the album in place.
//
// Built in CSS rather than with a motion library. The whole animation is two clip-paths and two
// opacities; adding ~50KB of JavaScript to the album route — the hot path every guest loads on a
// phone at an event — to express that would be a bad trade, and this codebase already pays careful
// attention to what reaches that page.
//
// SEQUENCING matters more than the animation. The curtain is raised over the COUNTDOWN, and the
// gate is only torn down on the next frame — clearing it in the same breath let the skeleton win
// the first paint, so the order on screen was skeleton, then curtain, then album. Backwards: the
// curtain exists precisely so that swap is never seen. The parting is then delayed past the point a
// fetch normally completes, so what appears behind it is the album rather than a loading state.

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

  // A CLIP WIPE, not a slide: the panels stay exactly where they are and are cut away from the
  // centre outwards, so the album is uncovered in place rather than having two doors pulled off it.
  //
  // Worth knowing what this costs. transform is composited on the GPU; clip-path is a paint-level
  // property, so a full-screen clip animation does more work per frame on a mid-range phone — the
  // device this actually plays on. It is two elements for about a second, which is affordable, and
  // will-change keeps each on its own layer. With a solid-colour panel the two look nearly
  // identical; if it ever judders, switching this back to a transform is a one-line change.
  const panel: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '51%',   // 1% overlap so no hairline of background shows down the seam
    background: WINE,
    transition: `clip-path ${PART_MS}ms cubic-bezier(0.65, 0, 0.35, 1), opacity ${FADE_MS}ms linear`,
    willChange: 'clip-path',
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
      {/* Each half is clipped away toward its own edge — left retreats left, right retreats right. */}
      <div style={{ ...panel, left: 0, clipPath: parted ? 'inset(0 100% 0 0)' : 'inset(0 0 0 0)' }} />
      <div style={{ ...panel, right: 0, clipPath: parted ? 'inset(0 0 0 100%)' : 'inset(0 0 0 0)' }} />

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
          // A whisper of scale as it goes, so the mark recedes rather than simply switching off.
          // Nothing slides any more, so a large movement here would be the only thing travelling.
          transform: parted ? 'scale(1.04)' : 'scale(1)',
          transition: `opacity 300ms ease-out, transform ${PART_MS}ms cubic-bezier(0.65, 0, 0.35, 1)`,
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
