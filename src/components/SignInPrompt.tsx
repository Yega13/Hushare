'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

// A branded, dismissible "Continue with Google" card shown at high-intent moments (owner saving their
// album, a guest who just found their photos, a download). Google sign-in captures a real account +
// verified email in one tap. Renders NOTHING for users who are already signed in.
//
// `next` is the same-origin path to return to after sign-in; the /auth/callback route reads it and
// redirects there once the session is established.

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.614z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  )
}

type Props = {
  title: string
  subtitle?: string
  cta?: string
  /** Optional secondary "no thanks" label under the button. Shown only when onDismiss is provided. */
  dismissLabel?: string
  /** Same-origin path to return to after sign-in. Defaults to the current path+query. */
  next?: string
  /** If set, dismissal is remembered in sessionStorage — no re-nag for the rest of the session. */
  storageKey?: string
  onDismiss?: () => void
}

export default function SignInPrompt({
  title,
  subtitle,
  cta = 'Continue with Google',
  dismissLabel = 'Maybe later',
  next,
  storageKey,
  onDismiss,
}: Props) {
  const [supabase] = useState(() => createClient())
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (storageKey) {
      try { if (sessionStorage.getItem(storageKey)) return } catch { /* private mode — ignore */ }
    }
    // Only show to signed-OUT users. Local session read (no network) is enough — we're not gating
    // anything sensitive, just deciding whether to show an offer.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled && !session) setVisible(true)
    }).catch(() => { /* if we can't tell, don't nag */ })
    return () => { cancelled = true }
  }, [supabase, storageKey])

  if (!visible) return null

  async function onGoogle() {
    if (busy) return
    setBusy(true)
    const origin = window.location.origin
    const target = next ?? (window.location.pathname + window.location.search)
    const callback = new URL('/auth/callback', origin)
    // Only ever return to a same-origin path (mirrors the login page's guard).
    try {
      const u = new URL(target, origin)
      callback.searchParams.set('next', u.origin === origin ? u.pathname + u.search : '/')
    } catch {
      callback.searchParams.set('next', '/')
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback.toString() },
    })
    if (error) setBusy(false) // on success we're navigating away, so leave it busy
  }

  function dismiss() {
    if (storageKey) { try { sessionStorage.setItem(storageKey, '1') } catch { /* ignore */ } }
    setVisible(false)
    onDismiss?.()
  }

  return (
    <div
      className="hush-signin-card"
      style={{
        position: 'relative',
        maxWidth: 396,
        margin: '0 auto',
        background: 'radial-gradient(120% 90% at 50% -10%, #FBF4EF 0%, #FFFFFF 46%)',
        border: '1px solid #ECE2D3',
        borderRadius: 22,
        padding: '32px 28px 26px',
        textAlign: 'center',
        boxShadow: '0 30px 70px -24px rgba(64,6,26,0.42), 0 3px 10px rgba(20,10,14,0.05)',
      }}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          position: 'absolute',
          top: 14,
          right: 14,
          background: 'transparent',
          border: 'none',
          color: '#C9BCA8',
          cursor: 'pointer',
          padding: 4,
          lineHeight: 0,
        }}
      >
        <X size={18} />
      </button>

      {/* Hushare aperture mark — quiet, on-brand, not an ad badge. */}
      <Image
        src="/logo/logo-icon-dark-transparent.png"
        alt="Hushare"
        width={46}
        height={46}
        style={{ display: 'block', margin: '0 auto 18px', width: 46, height: 'auto' }}
      />

      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 700, color: '#3A121F', lineHeight: 1.22 }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 14, color: '#8A7A66', marginTop: 9, lineHeight: 1.5, maxWidth: 300, marginInline: 'auto' }}>
          {subtitle}
        </div>
      )}

      <button
        type="button"
        onClick={onGoogle}
        disabled={busy}
        className="hush-press hush-signin-google"
        style={{
          marginTop: 24,
          width: '100%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          background: '#FFFFFF',
          color: '#2A211C',
          border: '1px solid #DCD2C0',
          borderRadius: 13,
          padding: '14px 18px',
          fontSize: 15,
          fontWeight: 600,
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.65 : 1,
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          whiteSpace: 'nowrap',
        }}
      >
        <GoogleIcon />
        {busy ? 'Signing you in…' : cta}
      </button>

      {onDismiss && (
        <button
          type="button"
          onClick={dismiss}
          style={{
            marginTop: 15,
            background: 'transparent',
            border: 'none',
            color: '#A2937E',
            fontSize: 13.5,
            fontWeight: 500,
            cursor: 'pointer',
            letterSpacing: '0.01em',
          }}
        >
          {dismissLabel}
        </button>
      )}
    </div>
  )
}
