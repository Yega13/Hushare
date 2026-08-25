'use client'

import { useEffect } from 'react'

// The sticky nav steps out of the way while you read down, and comes straight back the moment you
// scroll up.
//
// On a phone that bar costs about 60px of a ~700px viewport — roughly a tenth of the screen —
// permanently, on pages that are almost entirely reading. Hiding it while someone moves down and
// returning it the instant they move up gives that back without ever making them hunt for it: the
// gesture that means "I want to go back" is the same one that brings the nav with it.
//
// Written against a scroll listener rather than `animation-timeline: scroll()`. This codebase has
// been here before with the footer reveal: scroll-driven animations are unsupported on iOS, which is
// most of this product's traffic, so the CSS version would do nothing for the people it is for.

const HIDDEN = 'hush-nav-hidden'
// Never hides near the top. Without this the bar flickers away on the first flick of a short page.
const ARM_AFTER_PX = 96
// Ignore the small jitters a finger produces while holding still.
const MIN_DELTA_PX = 6

export default function ScrollHideNav() {
  useEffect(() => {
    const navs = Array.from(document.querySelectorAll<HTMLElement>('.hush-nav'))
    if (navs.length === 0) return

    // Someone who asked for less motion keeps the bar exactly where it is.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let last = window.scrollY
    let ticking = false
    let hidden = false

    const apply = (next: boolean) => {
      if (next === hidden) return
      hidden = next
      for (const nav of navs) nav.classList.toggle(HIDDEN, next)
    }

    const measure = () => {
      ticking = false
      const y = window.scrollY

      // The hamburger's scroll lock pins the body with position:fixed, which makes scrollY read 0
      // and would otherwise snap the bar back into view — or worse, hide it while its own close
      // button is the thing on screen. While the menu owns the page, this does nothing at all.
      if (document.body.style.position === 'fixed') return

      const delta = y - last
      if (Math.abs(delta) < MIN_DELTA_PX) return
      last = y

      // Up, or near the top, always shows it. Only sustained downward movement hides it.
      if (y < ARM_AFTER_PX || delta < 0) apply(false)
      else apply(true)
    }

    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(measure)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      for (const nav of navs) nav.classList.remove(HIDDEN)
    }
  }, [])

  return null
}
