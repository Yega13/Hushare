'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

// Reveals `.hush-reveal` elements as they come into view. Renders nothing.
//
// The class already existed and did not do this. It was built on `animation-timeline: view()`, with
// a plain time-based fade as the fallback — and the fallback is what most of this product's
// visitors get, because scroll-driven animations do not exist on iOS. So on a phone every
// `.hush-reveal` on the page played its entrance at load, including the ones several screens down,
// and by the time anyone scrolled to them the animation was long finished. The footer reveal
// learned this same lesson and was rewritten for the same reason.
//
// FAILS VISIBLE. The hidden state is scoped to a class this component puts on <html>, so if the
// JavaScript never runs — an error, an old browser, a blocked bundle — nothing is ever hidden and
// the page reads exactly as it would have. Hiding content by default and relying on script to
// reveal it is how a page ends up blank for the people whose script did not arrive.

const ARMED = 'hush-reveal-armed'
const IN = 'is-in'

export default function ScrollReveal() {
  // Re-scans on navigation. The component lives in the root layout and is NOT remounted between
  // routes, so without this the second page a visitor opens would have nothing observed.
  const pathname = usePathname()

  useEffect(() => {
    // Someone who asked for less motion gets the page, with nothing hidden and nothing to wait for.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const root = document.documentElement
    const targets = Array.from(document.querySelectorAll<HTMLElement>('.hush-reveal'))
    if (targets.length === 0) return

    root.classList.add(ARMED)

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add(IN)
          // One shot. A section that fades out again when scrolled past is a page that feels
          // unstable to read, and it doubles the work for no one's benefit.
          observer.unobserve(entry.target)
        }
      },
      // A margin rather than a threshold: the reveal should be finishing as the element arrives, not
      // starting once it is already sitting in the middle of the screen being looked at.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.01 },
    )

    for (const el of targets) {
      // Anything already on screen at load is revealed immediately rather than animated in — the
      // first paint should not be a page assembling itself.
      const box = el.getBoundingClientRect()
      if (box.top < window.innerHeight && box.bottom > 0) el.classList.add(IN)
      else observer.observe(el)
    }

    return () => {
      observer.disconnect()
      root.classList.remove(ARMED)
    }
  }, [pathname])

  return null
}
