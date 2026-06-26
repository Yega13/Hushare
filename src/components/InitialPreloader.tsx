'use client'

import { useEffect, useState } from 'react'
import BrandPreloader from '@/components/BrandPreloader'

const SEEN_KEY = 'hushare.initialPreloaderSeen'

export default function InitialPreloader() {
  const [phase, setPhase] = useState<'checking' | 'visible' | 'leaving' | 'hidden'>('checking')

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(SEEN_KEY) === '1') {
        document.body.classList.remove('hush-page-preloading', 'hush-scroll-locked')
        setPhase('hidden')
        return
      }

      window.sessionStorage.setItem(SEEN_KEY, '1')
    } catch {
      document.body.classList.add('hush-page-preloading', 'hush-scroll-locked')
    }

    setPhase('visible')
    document.body.classList.add('hush-page-preloading', 'hush-scroll-locked')

    const leaveTimeout = window.setTimeout(() => {
      setPhase('leaving')
      document.body.classList.remove('hush-page-preloading', 'hush-scroll-locked')
      document.body.classList.add('hush-page-loaded')
    }, 1750)
    const hideTimeout = window.setTimeout(() => setPhase('hidden'), 2310)
    const cleanupLoadedTimeout = window.setTimeout(() => {
      document.body.classList.remove('hush-page-loaded')
    }, 2400)

    return () => {
      window.clearTimeout(leaveTimeout)
      window.clearTimeout(hideTimeout)
      window.clearTimeout(cleanupLoadedTimeout)
      document.body.classList.remove('hush-page-preloading', 'hush-scroll-locked', 'hush-page-loaded')
    }
  }, [])

  if (phase === 'checking' || phase === 'hidden') return null

  return (
    <div className={`hush-initial-preloader hush-initial-preloader-${phase}`}>
      <BrandPreloader label="Loading Hushare" />
    </div>
  )
}
