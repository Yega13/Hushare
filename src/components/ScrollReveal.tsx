'use client'

import { useEffect } from 'react'

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
  // NO ROUTER HOOK. The first version called usePathname() to re-scan after a navigation, and this
  // component lives in the ROOT LAYOUT — a client hook that reads the current route there forces
  // every statically rendered page out of that mode, and the home page started reporting React
  // #419: the server could not finish a Suspense boundary and fell back to client rendering. The
  // visible symptom was that nothing faded in at all, because a component that never ran never
  // armed the effect.
  //
  // A MutationObserver does the same job without asking the router anything: new .hush-reveal nodes
  // are picked up whenever they appear, which covers a navigation, a filter, and content that loads
  // late — all of which the pathname version would have missed anyway.
  useEffect(() => {
    // Someone who asked for less motion gets the page, with nothing hidden and nothing to wait for.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const root = document.documentElement
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

    const scan = () => {
      for (const el of document.querySelectorAll<HTMLElement>(`.hush-reveal:not(.${IN})`)) {
        if (el.dataset.hushObserved === '1') continue
        el.dataset.hushObserved = '1'
        // Anything already on screen is revealed immediately rather than animated in — a first
        // paint should not be a page assembling itself, and neither should the top of a page you
        // have just navigated to.
        const box = el.getBoundingClientRect()
        if (box.top < window.innerHeight && box.bottom > 0) el.classList.add(IN)
        else observer.observe(el)
      }
    }
    scan()

    // Coalesced to one scan per frame: a navigation replaces a whole subtree and would otherwise
    // fire this once per inserted node.
    let queued = 0
    const mutations = new MutationObserver(() => {
      if (queued) return
      queued = requestAnimationFrame(() => { queued = 0; scan() })
    })
    mutations.observe(document.body, { childList: true, subtree: true })

    return () => {
      mutations.disconnect()
      observer.disconnect()
      if (queued) cancelAnimationFrame(queued)
      root.classList.remove(ARMED)
    }
  }, [])

  return null
}
