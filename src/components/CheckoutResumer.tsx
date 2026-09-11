'use client'

import { useEffect, useRef } from 'react'
import { useBrowserValue } from '@/lib/use-browser-value'

// Stable plan keys only (see lib/polar.ts) — never a raw Polar product ID, so this resume link
// stays valid even if the underlying product ID is later rotated.
const PLAN_KEY_RE = /^(pro|studio)_(monthly|yearly)$/

export default function CheckoutResumer() {
  const formRef = useRef<HTMLFormElement>(null)
  // The query string does not exist while the server renders, so it is read after hydration.
  // Validated here rather than trusted: this value is posted to the checkout.
  const plan = useBrowserValue(() => {
    const p = new URLSearchParams(window.location.search).get('plan')
    return p && PLAN_KEY_RE.test(p) ? p : null
  }, null as string | null)

  useEffect(() => {
    if (plan) formRef.current?.submit()
  }, [plan])

  if (!plan) return null

  return (
    <>
      <form ref={formRef} action="/api/checkout" method="POST" className="hidden">
        <input type="hidden" name="plan" value={plan} />
      </form>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: 'rgba(253,250,245,0.92)', backdropFilter: 'blur(4px)' }}
        aria-live="polite"
        role="status"
      >
        <p className="text-base" style={{ color: '#630826', fontFamily: 'var(--font-serif)' }}>
          Resuming your checkout...
        </p>
      </div>
    </>
  )
}
