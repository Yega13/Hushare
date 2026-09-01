'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Album } from '@/types'
import { packageExpired } from '@/lib/album-entitlements'
import {
  packageThanksState, THANKS_POLL_MS, THANKS_SLOW_AFTER_MS, type ThanksState,
} from '@/lib/package-thanks'

// THE LANDING AFTER PAYMENT. Polar sends the buyer here with ?package=thanks, and this is the only
// thing on the page that knows a payment just happened.
//
// Rendered for whoever arrives, not just the owner: the redirect comes back through Polar, so the
// #owner= fragment is gone and the buyer lands in the ordinary guest view of their own album.
// Nothing here is private — that the album has a package is already in the payload.
type Props = { album: Album; onApplied?: (album: Album) => void }

export default function PackageThanksBanner({ album, onApplied }: Props) {
  const pkgOf = (a: Album) => ({ tier: a.package_tier ?? null, expiresAt: a.package_expires_at ?? null })
  const [live, setLive] = useState(() => !packageExpired(pkgOf(album)))
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number>(0)
  const appliedRef = useRef(onApplied)
  appliedRef.current = onApplied

  useEffect(() => {
    // performance.now: a monotonic origin, so a clock correction during checkout cannot make this
    // banner think 45 seconds passed (rule 22).
    startRef.current = performance.now()
    if (live) return

    let cancelled = false
    const slug = album.custom_slug ?? album.slug

    const tick = async () => {
      if (cancelled) return
      setElapsed(performance.now() - startRef.current)
      try {
        const res = await fetch(`/api/album/resolve?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const body = (await res.json()) as { album?: Album }
        const fresh = body.album
        if (!fresh || packageExpired(pkgOf(fresh))) return
        setLive(true)
        // Hand the fresh album up so the rest of the page unlocks with it, rather than the owner
        // having to reload to see what they just paid for.
        appliedRef.current?.(fresh)
      } catch {
        // A failed poll is not an answer. The next tick asks again; only the clock decides 'slow'.
      }
    }

    const id = window.setInterval(() => void tick(), THANKS_POLL_MS)
    void tick()
    return () => { cancelled = true; window.clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album.slug, album.custom_slug])

  // Stop the page at 'applying' forever if the poll never resolves: the timer keeps running so the
  // banner can reach 'slow' even while every fetch is failing.
  useEffect(() => {
    if (live) return
    const id = window.setInterval(() => setElapsed(performance.now() - startRef.current), THANKS_POLL_MS)
    return () => window.clearInterval(id)
  }, [live])

  const state: ThanksState | null = packageThanksState(true, live, elapsed)
  if (state === null) return null

  const copy: Record<ThanksState, { title: string; body: React.ReactNode; tone: string }> = {
    applying: {
      title: 'Payment received',
      body: 'Applying your package to this album — this usually takes a few seconds.',
      tone: '#7C4A2D',
    },
    applied: {
      title: 'Your package is active',
      body: (
        <>
          Everything it includes is on this album now.{' '}
          <Link href="/account" style={{ textDecoration: 'underline' }}>Manage it from your account</Link>.
        </>
      ),
      tone: '#2E6B4F',
    },
    slow: {
      title: 'Payment received — still applying',
      body: (
        <>
          This is taking longer than usual. Your payment is safe and nothing is lost; do not pay
          again. If it has not appeared shortly, email{' '}
          <a href="mailto:support@hushare.space" style={{ textDecoration: 'underline' }}>support@hushare.space</a>{' '}
          and we will finish it by hand.
        </>
      ),
      tone: '#A33',
    },
  }
  const { title, body, tone } = copy[state]

  return (
    <div className="hush-container" style={{ marginBottom: 12 }}>
      <div
        role="status"
        style={{
          padding: '12px 16px', borderRadius: 12,
          background: '#FFFFFF', border: `1px solid ${tone}33`, borderLeft: `3px solid ${tone}`,
        }}
      >
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: tone }}>{title}</p>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#6B5A4E' }}>{body}</p>
      </div>
    </div>
  )
}

export { THANKS_SLOW_AFTER_MS }
