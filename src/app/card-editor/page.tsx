import { Suspense } from 'react'
import type { Metadata } from 'next'
import CardEditorWrapper from './CardEditorWrapper'

export const runtime = 'nodejs'

export const metadata: Metadata = {
  title: 'Card Editor — Hushare',
  robots: { index: false, follow: false },
}

export default function CardEditorPage() {
  return (
    <Suspense fallback={<div className="hush-route-loading" role="status" aria-live="polite"><span className="hush-route-loading-dot" /></div>}>
      <CardEditorWrapper />
    </Suspense>
  )
}
