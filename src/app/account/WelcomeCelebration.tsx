'use client'

import { useEffect, useState } from 'react'
import Confetti from '@/components/Confetti'
import WelcomeModal from './WelcomeModal'

// Fires exactly once, at the moment a payment is confirmed.
//
// The gate is upstream, in page.tsx, and it is a real one rather than a query string: Polar sends
// the customer to /account?welcome=1, and the page only reaches this component once
// hasAccountAccess is TRUE. A checkout that never completed lands on the polling screen instead, so
// nobody is congratulated for a payment that did not happen.
export default function WelcomeCelebration({
  plan,
  features,
}: {
  plan: 'Pro' | 'Max'
  features: string[]
}) {
  const [showModal, setShowModal] = useState(true)
  // Nothing is celebrated over the top of the opening preloader — see below.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Drop ?welcome from the address bar.
    //
    // Two reasons, and the second is the one that matters. It stops a refresh — or a bookmark, or
    // the back button — replaying the celebration, which is what turns a moment into a gimmick. And
    // it stops the page being pinned in its just-paid state forever in someone's tabs.
    //
    // Native replaceState, which Next supports for exactly this: changing the URL without a
    // navigation. router.replace would re-run the server component and repaint the whole dashboard
    // underneath the animation — and unmount this component mid-confetti.
    //
    // window.history.state is passed BACK IN rather than null. Next keeps its own routing data on
    // the history entry (__NA and the internals tree) and its patched replaceState carries that
    // forward for you — but the patch is installed in AppRouter's OWN effect, and React runs child
    // effects before parent ones, so on first hydration this call can reach the untouched native
    // method. Passing null there wipes Next's state, and its popstate handler returns early on an
    // entry with no state: the BACK BUTTON silently stops working for that entry. Preserving
    // whatever is already on the entry is correct whether the patch is in place or not.
    const url = new URL(window.location.href)
    if (!url.searchParams.has('welcome')) return
    url.searchParams.delete('welcome')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  }, [])

  useEffect(() => {
    // WAIT FOR THE OPENING PRELOADER, if it is running.
    //
    // The brand preloader covers the whole viewport at z-index 2147483647 for 1.5s plus a fade —
    // about two thirds of the confetti and the entire entrance of the card. The customer would have
    // watched a loading screen and then found a card sitting still with the party already over.
    // It normally does not run here (it is once per browser), but it runs on EVERY load when
    // localStorage is unavailable: Safari with site data blocked, lockdown mode, some private
    // windows.
    // Waiting also settles a second collision. The preloader releases 'hush-scroll-locked' on a
    // timer, unconditionally, and classList is a set rather than a reference count — so it would
    // have taken the modal's scroll lock away with it. Starting afterwards means the modal's lock
    // is the last one applied.
    if (!document.body.classList.contains('hush-page-preloading')) {
      // Next frame rather than straight away: the common case by far, and starting after the
      // dashboard has painted once means the confetti's first frame is not competing with it.
      const raf = requestAnimationFrame(() => setReady(true))
      return () => cancelAnimationFrame(raf)
    }
    const observer = new MutationObserver(() => {
      if (!document.body.classList.contains('hush-page-preloading')) {
        setReady(true)
        observer.disconnect()
      }
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    // Never wait forever on a class that might not be cleared.
    const bail = window.setTimeout(() => { setReady(true); observer.disconnect() }, 4000)
    return () => { observer.disconnect(); window.clearTimeout(bail) }
  }, [])

  if (!ready) return null

  return (
    <>
      {/* Behind the card, deliberately — z 9998 against the modal's 9999. In front, it would be
          confetti thrown over the one thing the customer is trying to read. */}
      <Confetti />
      {showModal && (
        <WelcomeModal plan={plan} features={features} onClose={() => setShowModal(false)} />
      )}
    </>
  )
}
