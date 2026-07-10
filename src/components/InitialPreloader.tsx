'use client'

import { useEffect, useState } from 'react'
import BrandPreloader from '@/components/BrandPreloader'

const SEEN_KEY = 'hushare.initialPreloaderSeen'

export default function InitialPreloader() {
  const [phase, setPhase] = useState<'checking' | 'visible' | 'leaving' | 'hidden'>('checking')

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SEEN_KEY) === '1') {
        document.body.classList.remove('hush-page-preloading', 'hush-scroll-locked')
        setPhase('hidden')
        return
      }

      window.localStorage.setItem(SEEN_KEY, '1')
    } catch {
      document.body.classList.add('hush-page-preloading', 'hush-scroll-locked')
    }

    setPhase('visible')
    document.body.classList.add('hush-page-preloading', 'hush-scroll-locked')

    const leaveTimeout = window.setTimeout(() => {
      setPhase('leaving')
      document.body.classList.remove('hush-page-preloading', 'hush-scroll-locked')
      document.body.classList.add('hush-page-loaded')
    }, 1500)
    const hideTimeout = window.setTimeout(() => setPhase('hidden'), 2060)
    const cleanupLoadedTimeout = window.setTimeout(() => {
      document.body.classList.remove('hush-page-loaded')
    }, 2150)

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
