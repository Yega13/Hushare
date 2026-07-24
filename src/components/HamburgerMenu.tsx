'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import Link from 'next/link'
import { useT } from '@/i18n/LocaleProvider'

// useLayoutEffect fires synchronously before any useEffect, so isMobile is
// resolved before AccountNavLink (or any stateful child) runs its effects.
// That means children mount exactly once — in the desktop div on desktop,
// or in the portal overlay on mobile — never in both simultaneously.
// Falls back to useEffect on the server (where window doesn't exist).
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

export default function HamburgerMenu({ children }: { children: React.ReactNode }) {
  const { t } = useT()
  const [open, setOpen]       = useState(false)
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const scrollYRef            = useRef(0)
  const hasOpenedRef          = useRef(false)

  useIsomorphicLayoutEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    setIsMobile(mq.matches)
    setMounted(true)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Close the menu and release scroll lock when viewport switches to desktop
  useEffect(() => {
    if (!isMobile) setOpen(false)
  }, [isMobile])

  // iOS-safe scroll lock: position:fixed + restore exact scroll position on close
  useEffect(() => {
    if (open) {
      hasOpenedRef.current = true
      scrollYRef.current = window.scrollY
      const s = document.body.style
      s.position = 'fixed'
      s.top      = `-${scrollYRef.current}px`
      s.left     = '0'
      s.right    = '0'
    } else if (hasOpenedRef.current) {
      const s = document.body.style
      s.position = ''
      s.top      = ''
      s.left     = ''
      s.right    = ''
      window.scrollTo(0, scrollYRef.current)
    }
    return () => {
      const s = document.body.style
      s.position = s.top = s.left = s.right = ''
    }
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Rendered via portal into document.body so it escapes the nav's
  // backdrop-filter stacking context (which breaks position:fixed children)
  const overlay = (
    <div
      className={`hush-mobile-overlay${open ? ' hush-mobile-overlay--open' : ''}`}
      aria-hidden={!open}
      onClick={() => setOpen(false)}
    >
      <Link
        href="/"
        className="hush-mobile-logo-link"
        aria-label="Hushare home"
        onClick={() => setOpen(false)}
      >
        <Image
          src="/logo/logo-dark-transparent.png"
          alt="Hushare"
          width={618}
          height={146}
          className="hush-mobile-logo-img"
          style={{ width: 'auto' }}
          draggable={false}
        />
      </Link>
      <nav className="hush-mobile-nav" onClick={() => setOpen(false)}>
        {children}
      </nav>
    </div>
  )

  return (
    <>
      {/* Desktop nav links — only rendered when not mobile, so stateful
          children (AccountNavLink) mount exactly once per page */}
      {!isMobile && (
        <div className="hush-nav-links hush-hamburger-desktop">
          {children}
        </div>
      )}

      {/* Hamburger button — always in DOM so CSS can show/hide without CLS */}
      <button
        type="button"
        aria-label={open ? t('menu.close') : t('menu.open')}
        aria-expanded={open}
        className={`hush-hamburger hamburger hamburger--elastic${open ? ' is-active' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="hamburger-box">
          <span className="hamburger-inner" />
        </span>
      </button>

      {/* Portal overlay — mobile only, mounted after layout detection */}
      {mounted && isMobile && createPortal(overlay, document.body)}
    </>
  )
}
