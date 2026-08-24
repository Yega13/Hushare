'use client'

import { useEffect } from 'react'
import Confetti from '@/components/Confetti'

// Fires exactly once, at the moment a payment is confirmed.
//
// The gate is upstream, in page.tsx, and it is a real one rather than a query string: Polar sends
// the customer to /account?welcome=1, and the page only reaches this component once
// hasAccountAccess is TRUE. A checkout that never completed lands on the polling screen instead, so
// nobody is congratulated for a payment that did not happen.
export default function WelcomeCelebration() {
  useEffect(() => {
    // Drop ?welcome=1 from the address bar.
    //
    // Two reasons, and the second is the one that matters. It stops a refresh — or a bookmark, or
    // the back button — replaying the celebration, which is what turns a moment into a gimmick. And
    // it stops the page being pinned in its just-paid state forever in someone's tabs.
    //
    // Native replaceState, which Next supports for exactly this: changing the URL without a
    // navigation. router.replace would re-run the server component and repaint the whole dashboard
    // underneath the animation.
    const url = new URL(window.location.href)
    if (!url.searchParams.has('welcome')) return
    url.searchParams.delete('welcome')
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  }, [])

  return <Confetti />
}
