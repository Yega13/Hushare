'use client'

import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { BTT_UPDATE_EVENT } from '@/lib/constants'

export default function BackToTop() {
  const [visible, setVisible] = useState(false)
  const [bottom, setBottom]   = useState(24)

  useEffect(() => {
    function update() {
      const scrollY        = window.scrollY
      const docHeight      = document.documentElement.scrollHeight
      const winHeight      = window.innerHeight
      // Clamp to 0 — iOS rubber-band overscroll makes scrollY exceed the page
      // height, producing a negative value that inflates targetBottom.
      const distFromBottom = Math.max(0, docHeight - scrollY - winHeight)

      setVisible(scrollY > 280)

      // Measure the actual footer height — zero on pages that have no footer (e.g. album pages)
      const footerEl     = document.querySelector('footer')
      const footerHeight = footerEl ? footerEl.offsetHeight : 0

      // Height of any fixed bottom bar (e.g. bulk-select toolbar), measured from the actual element
      const barHeight = parseInt(document.documentElement.dataset.bttBarHeight ?? '0', 10) || 0

      // Smoothly push the button up as the footer enters the viewport; clear the bar when present
      const targetBottom = Math.max(24 + barHeight, footerHeight - distFromBottom + 24 + barHeight)
      setBottom(targetBottom)
    }

    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener(BTT_UPDATE_EVENT, update)
    update()
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener(BTT_UPDATE_EVENT, update)
    }
  }, [])

  return (
    <button
      type="button"
      aria-label="Back to top"
      className="hush-back-to-top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      style={{
        position:      'fixed',
        right:         '1.25rem',
        bottom:        `${bottom}px`,
        zIndex:        80,
        width:         '42px',
        height:        '42px',
        borderRadius:  '50%',
        background:    '#630826',
        color:         '#FDFAF5',
        border:        'none',
        cursor:        'pointer',
        display:       'flex',
        alignItems:    'center',
        justifyContent:'center',
        boxShadow:     '0 4px 16px rgba(99,8,38,0.28)',
        opacity:        visible ? 1 : 0,
        pointerEvents:  visible ? 'auto' : 'none',
        transition:    'opacity 0.22s ease, bottom 0.18s ease',
      }}
    >
      <ArrowUp size={18} strokeWidth={2.5} />
    </button>
  )
}
