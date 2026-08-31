'use client'

import dynamic from 'next/dynamic'
import { retryImport } from '@/lib/lazy-retry'

const CardEditorClient = dynamic(retryImport(() => import('./CardEditorClient')), { ssr: false })

export default function CardEditorWrapper() {
  return <CardEditorClient />
}
