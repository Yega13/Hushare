'use client'

import { useEffect, useRef, useState } from 'react'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function CheckoutResumer() {
  const formRef = useRef<HTMLFormElement>(null)
  const [productId, setProductId] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('product')
    if (id && UUID_RE.test(id)) setProductId(id)
  }, [])

  useEffect(() => {
    if (productId) formRef.current?.submit()
  }, [productId])

  if (!productId) return null

  return (
    <>
      <form ref={formRef} action="/api/checkout" method="POST" className="hidden">
        <input type="hidden" name="productId" value={productId} />
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
