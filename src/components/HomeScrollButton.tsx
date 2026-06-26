'use client'

import { ArrowRight } from 'lucide-react'

export default function HomeScrollButton() {
  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="hush-press mt-7 inline-flex items-center gap-2 font-semibold transition hover:opacity-90"
      style={{
        background: '#254F22',
        color: '#FDFAF5',
        padding: '14px 28px',
        borderRadius: '999px',
        boxShadow: '0 6px 18px rgba(37,79,34,0.35)',
      }}
    >
      Create your album <ArrowRight className="w-4 h-4" />
    </button>
  )
}
