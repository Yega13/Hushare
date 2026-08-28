'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

// Fire-and-forget presence heartbeat so the admin dashboard can show a live active-user count. Pings
// /api/presence on mount, every 30s, and whenever the tab becomes visible again. One random id per
// tab (sessionStorage). Skipped on /admin so monitoring the dashboard doesn't inflate the number.
export default function PresenceBeacon() {
  const pathname = usePathname()

  useEffect(() => {
    if (!pathname || pathname.startsWith('/admin')) return

    let id = ''
    try {
      id = sessionStorage.getItem('hushare.sid') ?? ''
      if (!id) {
        id = Math.random().toString(36).slice(2) + Date.now().toString(36)
        sessionStorage.setItem('hushare.sid', id)
      }
    } catch {
      id = Math.random().toString(36).slice(2)
    }

    const ping = () => {
      if (document.visibilityState === 'hidden') return
      try {
        void fetch('/api/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, path: pathname }),
          keepalive: true,
        }).catch(() => {})
      } catch { /* ignore */ }
    }

    ping()
    // 60s, not 30s. A presence row lives for TEN MINUTES (api/cron/prune-data), so pinging twice
    // a minute was four times more often than the data it feeds is even kept. At an event that
    // difference is not academic: 300 guests behind one venue IP produced 600 pings a minute
    // against a 120/min ceiling, so most of them were refused and the "active right now" figure
    // was wrong at exactly the moment anyone would look at it.
    const iv = setInterval(ping, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') ping() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [pathname])

  return null
}
