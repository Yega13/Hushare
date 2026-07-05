'use client'

import { useEffect, useState } from 'react'

// True when the viewport is narrower than `breakpoint` (default 640px). Used to switch the
// share menu between a mobile centred panel and a desktop dropdown. SSR-safe: starts false
// and updates on mount, so it never mismatches the server-rendered (desktop) markup.
export function useIsNarrow(breakpoint = 640): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < breakpoint)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])
  return narrow
}
