'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/LocaleProvider'

const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 15 // 30 seconds total

export default function SubscriptionPolling({ email }: { email: string }) {
  const { t } = useT()
  const router = useRouter()
  const routerRef = useRef(router)
  const [givenUp, setGivenUp] = useState(false)
  const pollsRef = useRef(0)

  // Keep routerRef current so the interval always calls the latest router.refresh
  // without needing router in the interval's effect deps (which would restart it).
  useEffect(() => { routerRef.current = router })

  useEffect(() => {
    pollsRef.current = 0
    let cancelled = false

    const id = window.setInterval(async () => {
      pollsRef.current += 1
      try {
        const res = await fetch('/api/me', { cache: 'no-store' })
        if (cancelled) return
        if (res.ok) {
          const me = (await res.json()) as { canAccessAccount: boolean }
          if (me.canAccessAccount) {
            window.clearInterval(id)
            routerRef.current.refresh()
            return
          }
        }
      } catch {
        // Network blip — try again next tick.
      }
      if (pollsRef.current >= MAX_POLLS && !cancelled) {
        window.clearInterval(id)
        setGivenUp(true)
      }
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, []) // intentionally empty — router changes via routerRef, not effect restart

  if (givenUp) {
    return (
      <main
        className="min-h-screen flex items-center justify-center px-4 py-16"
        style={{ background: '#FDFAF5' }}
        role="status"
        aria-live="polite"
        aria-label={t('acct.subStatus')}
      >
        <div
          className="max-w-md w-full rounded-2xl p-8 text-center"
          style={{
            background: '#FFFFFF',
            border: '1px solid #DDD5C5',
            boxShadow: '0 4px 32px rgba(99,8,38,0.10)',
          }}
        >
          <p
            className="text-xs uppercase mb-3"
            style={{ color: '#8B6F4E', letterSpacing: '0.18em', fontWeight: 600 }}
          >
            {t('sub.almostThere')}
          </p>
          <h1
            className="text-2xl font-bold mb-3"
            style={{ color: '#630826', fontFamily: 'var(--font-serif)' }}
          >
            {t('sub.stillConfirming')}
          </h1>
          <p className="text-sm leading-relaxed mb-5" style={{ color: '#5C4A3C' }}>
            {t('sub.delayBody1')}{' '}
            <a
              href="mailto:husharesupport@gmail.com"
              style={{ color: '#630826', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
            >
              husharesupport@gmail.com
            </a>
            {t('sub.delayFrom')}<strong className="break-all">{email}</strong>{t('sub.delayTail')}
          </p>
          <button
            type="button"
            onClick={() => routerRef.current.refresh()}
            className="w-full font-semibold rounded-xl py-2.5 text-sm transition hover:opacity-90"
            style={{ background: '#630826', color: '#FDFAF5' }}
          >
            {t('sub.refresh')}
          </button>
        </div>
      </main>
    )
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 py-16"
      style={{ background: '#FDFAF5' }}
      role="status"
      aria-live="polite"
      aria-label={t('acct.subStatus')}
    >
      <div
        className="max-w-md w-full rounded-2xl p-10 text-center"
        style={{
          background: '#FFFFFF',
          border: '1px solid #DDD5C5',
          boxShadow: '0 4px 32px rgba(99,8,38,0.10)',
        }}
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-5"
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: '3px solid #DDD5C5',
            borderTopColor: '#630826',
            animation: 'spin 0.9s linear infinite',
          }}
        />
        <h1
          className="text-xl font-bold mb-2"
          style={{ color: '#630826', fontFamily: 'var(--font-serif)' }}
        >
          {t('sub.confirming')}
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: '#5C4A3C' }}>
          {t('sub.confirmingBody')}
        </p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </main>
  )
}
