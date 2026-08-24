'use client'

import { useEffect, useRef } from 'react'

// The one moment in this product worth celebrating: someone just paid.
//
// Deliberately NOT on upload, where it first went. Uploading happens dozens of times per guest per
// album, and a celebration that fires on every repetition stops being a celebration and becomes
// noise in front of the thing the guest is actually trying to look at. Paying happens once.
//
// Written against a canvas rather than pulled from a library. canvas-confetti is ~7KB gzipped plus
// its own rAF loop, and this is 150 lines of arithmetic; on a route that a paying customer reaches
// on a phone, the whole effect costs one element and no layout work at all. Every particle lives in
// a single bitmap, so the browser composites one layer instead of reflowing a hundred DOM nodes.

// Chosen to read against the modal's dark wine scrim, which is what is behind them for most of
// their life. The deepest brand wine was in here first and simply disappeared into it.
const COLORS = ['#7E1236', '#A8123C', '#D4AF6A', '#8B6F4E', '#F2E3CE']

const DURATION_MS = 2600   // how long particles keep being interesting
const FADE_MS = 600        // the tail, so nothing ever pops out of existence
const GRAVITY = 0.00075    // px per ms², tuned by eye against the fall time below
const DRAG = 0.9993        // air resistance per ms — stops the cannons firing off-screen flat

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  color: string
  spin: number      // radians per ms
  angle: number
  tumble: number    // phase of the flat-ribbon flip
  tumbleRate: number
}

// Two cannons in the bottom corners, angled inward and up.
//
// A top-down rain was the other option and was rejected: falling from above reads as weather, or
// worse as something going wrong. Firing UP from the corners reads as celebration, and it clears
// the middle of the screen — where the plan the customer just bought is written — almost at once.
function makeParticles(w: number, h: number): Particle[] {
  // Fewer on a phone. This runs on the device a customer is holding at the moment they have just
  // been charged; a stutter there is the worst possible first impression of a paid plan.
  const count = w < 640 ? 70 : 140
  const out: Particle[] = []

  for (let i = 0; i < count; i++) {
    const fromLeft = i % 2 === 0
    // Spread around 60° from horizontal, inward.
    const spread = (Math.random() - 0.5) * 0.9
    const angle = (fromLeft ? -Math.PI / 3 : -Math.PI * 2 / 3) + spread
    // Tuned against captured frames, not by feel. With this drag the velocity decays on a ~1.4s
    // time constant, so a particle travels roughly speed x 1430 px before it runs out: at 0.5x that
    // horizontally, the two cannons throw across most of a 1200px screen and meet in the middle.
    // Vertically it reaches 380-650px, which arcs over the centre of the page without leaving the
    // top. The first attempt used half this and produced two sad piles in the corners.
    const speed = 1.05 + Math.random() * 0.5   // px per ms

    out.push({
      x: fromLeft ? -10 : w + 10,
      y: h * (0.92 + Math.random() * 0.1),
      // No direction multiplier: the angle carries it. cos(-60°) is +x out of the left corner,
      // cos(-120°) is -x out of the right one.
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 6 + Math.random() * 5,
      h: 9 + Math.random() * 7,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      spin: (Math.random() - 0.5) * 0.012,
      angle: Math.random() * Math.PI * 2,
      tumble: Math.random() * Math.PI * 2,
      tumbleRate: 0.004 + Math.random() * 0.005,
    })
  }
  return out
}

export default function Confetti() {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    // Somebody who asked for less motion still gets their plan; they simply do not get thrown a
    // party about it.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Capped at 2. A 3x phone screen would triple the fill cost for a difference nobody can see on
    // a 6px rectangle moving at speed.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let w = window.innerWidth
    let h = window.innerHeight

    const size = () => {
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    size()
    window.addEventListener('resize', size)

    // Hand the memory back the moment the party is over, without unmounting.
    //
    // A full-screen backing store is around 14MB at 2x on a large display, and it was being held for
    // the rest of the session along with a live resize listener that reallocated and cleared all of
    // it on every resize — which on a phone means every time the URL bar collapses. Zeroing the
    // canvas frees the buffer; the element itself is inert at 0x0 and costs nothing. Doing this
    // instead of a `done` state also keeps the component free of a render triggered from inside an
    // effect, and free of any server/client difference in what it renders.
    let released = false
    const release = () => {
      if (released) return
      released = true
      window.removeEventListener('resize', size)
      canvas.width = 0
      canvas.height = 0
      canvas.style.width = '0px'
      canvas.style.height = '0px'
    }

    const particles = makeParticles(w, h)
    let raf = 0
    let last = performance.now()
    let elapsed = 0

    const frame = (now: number) => {
      // Clamped. A backgrounded tab hands back a delta of several seconds on return, which would
      // teleport every particle into the far distance in one step and end the effect mid-air.
      const dt = Math.min(now - last, 34)
      last = now
      elapsed += dt

      ctx.clearRect(0, 0, w, h)

      // The tail fades the whole bitmap rather than each particle, which is one property instead of
      // a hundred.
      const fading = elapsed - DURATION_MS
      ctx.globalAlpha = fading > 0 ? Math.max(0, 1 - fading / FADE_MS) : 1

      let visible = 0
      for (const p of particles) {
        p.vy += GRAVITY * dt
        const drag = DRAG ** dt
        p.vx *= drag
        p.vy *= drag
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.angle += p.spin * dt
        p.tumble += p.tumbleRate * dt

        if (p.y - p.h > h) continue   // fallen out of the world; stop drawing it
        visible++

        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.angle)
        // Squashing the height by a cosine is what sells a flat piece of paper turning over. Real
        // 3D would need a transform per particle and buys nothing at this size.
        ctx.scale(1, Math.abs(Math.cos(p.tumble)) * 0.85 + 0.15)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }

      // Ends on its own terms: when the party is over, or when everything has already fallen off
      // the bottom. No timer to keep in step with the physics.
      if (visible === 0 || elapsed > DURATION_MS + FADE_MS) {
        ctx.clearRect(0, 0, w, h)
        release()
        return
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      release()
    }
  }, [])

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        // Never swallows a tap. The customer can start using what they bought while it is still
        // in the air.
        pointerEvents: 'none',
      }}
    />
  )
}
