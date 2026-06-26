'use client'

import dynamic from 'next/dynamic'

const CardEditorClient = dynamic(() => import('./CardEditorClient'), { ssr: false })

export default function CardEditorWrapper() {
  return <CardEditorClient />
}
