'use client'

import { useEffect, useState } from 'react'
import { Send, CheckCircle2, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/LocaleProvider'

type Status = 'idle' | 'sending' | 'sent' | 'error'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Validate ?next= so only same-origin paths are allowed. The URL constructor
// normalises %2F%2F and other encoding tricks before the origin check.
function parseSafeNext(raw: string): string {
  if (!raw) return ''
  try {
    const url = new URL(raw, window.location.origin)
    if (url.origin !== window.location.origin) return ''
    return url.pathname + url.search
  } catch {
    return ''
  }
}

function buildCallbackUrl(base: string = window.location.origin): string {
  const params = new URLSearchParams(window.location.search)
  const safeNext = parseSafeNext(params.get('next') ?? '')
  const url = new URL('/auth/callback', base)
  if (safeNext) url.searchParams.set('next', safeNext)
  return url.toString()
}

// Base for a link that gets EMAILED. window.location.origin is right for OAuth, which comes back
// to the same browser, and wrong here: the whole point of "email me a link" is that it is often
// opened somewhere else — the laptop asks, the phone opens it. A link built on
// http://localhost:3000 is dead on any other device, and that is exactly how this surfaced.
// Pinned to the canonical site in production; in local development localhost genuinely IS the site.
function emailLinkBase(): string {
  const canonical = process.env.NEXT_PUBLIC_SITE_URL
  if (canonical && process.env.NODE_ENV === 'production') return canonical
  return window.location.origin
}

export default function LoginForm() {
  const { t } = useT()
  const [supabase] = useState(() => createClient())
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [oauthBusy, setOauthBusy] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [otpBusy, setOtpBusy] = useState(false)
  const [otpError, setOtpError] = useState('')

  // Poll /api/me while waiting on a magic link so this tab follows when
  // the user clicks the link in another tab (cookies are shared).
  useEffect(() => {
    if (status !== 'sent') return
    let cancelled = false
    // Stop polling after 10 minutes (240 ticks × 2500ms) — magic links expire and
    // an indefinite interval would hold a Supabase connection open forever.
    let ticks = 0
    async function check() {
      if (++ticks > 240) { clearInterval(interval); return }
      try {
        const res = await fetch('/api/me', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { signedIn?: boolean; canAccessAccount?: boolean }
        if (cancelled || !data.signedIn) return
        continueSignedIn(data.canAccessAccount)
      } catch {
        // Transient errors — next tick retries.
      }
    }
    check()
    const interval = setInterval(check, 2500)
    return () => { cancelled = true; clearInterval(interval) }
  }, [status])

  // Where a fresh session should land — the same answer whether it arrived via the poller (link
  // opened in another tab of THIS browser) or via the code below (link opened on another DEVICE).
  function continueSignedIn(canAccessAccount?: boolean) {
    const params = new URLSearchParams(window.location.search)
    const safeNext = parseSafeNext(params.get('next') ?? '')
    window.location.href = safeNext || (canAccessAccount ? '/account' : '/')
  }

  // THE CROSS-DEVICE PATH. A magic link signs in whichever browser OPENS it — and people read
  // email on their phone. Observed exactly: checkout started on a laptop, the link tapped on the
  // phone, the PHONE landed in the Polar checkout while the laptop sat on "check your inbox"
  // forever (cookies do not cross devices, so the poller can never see that session). Typing the
  // six-digit code from the same email signs in THIS device — the one actually mid-purchase.
  async function onSubmitCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const token = otpCode.trim()
    if (!/^[0-9]{6}$/.test(token)) {
      setOtpError(t('login.codeInvalid'))
      return
    }
    setOtpBusy(true)
    setOtpError('')
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' })
    if (error) {
      setOtpBusy(false)
      // Supabase's raw message here is "Token has expired or is invalid" — ours says what to DO.
      setOtpError(t('login.codeWrong'))
      return
    }
    continueSignedIn()
  }

  async function onGoogle() {
    if (oauthBusy || status === 'sending') return
    setOauthBusy(true)
    setErrorMsg('')
    setStatus('idle')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: buildCallbackUrl() },
    })
    if (error) {
      setOauthBusy(false)
      setStatus('error')
      setErrorMsg(error.message)
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === 'sending' || oauthBusy) return
    const trimmed = email.trim()
    if (!EMAIL_RE.test(trimmed)) {
      setStatus('error')
      setErrorMsg(t('login.invalidEmail'))
      return
    }
    setStatus('sending')
    setErrorMsg('')
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: buildCallbackUrl(emailLinkBase()) },
    })
    if (error) {
      setStatus('error')
      setErrorMsg(error.message)
      return
    }
    setStatus('sent')
  }

  if (status === 'sent') {
    return (
      <div
        className="rounded-2xl p-8 text-center"
        style={{ background: '#F6E9EE', border: '1px solid #C8D6C2' }}
      >
        <CheckCircle2 className="w-10 h-10 mx-auto mb-3" style={{ color: '#630826' }} />
        <h3
          className="text-xl font-bold mb-2"
          style={{ color: '#630826', fontFamily: 'var(--font-serif)' }}
        >
          {t('login.sentTitle')}
        </h3>
        <p className="text-sm mb-1" style={{ color: '#5C4A3C' }}>
          {t('login.sentTo')} <strong>{email}</strong>.
        </p>
        <p className="text-xs mt-3" style={{ color: '#8B6F4E' }}>
          {t('login.sentExpiry')}
        </p>

        <form onSubmit={onSubmitCode} className="mt-5 text-left">
          <label htmlFor="otp" className="block text-sm font-medium mb-2" style={{ color: '#8B6F4E' }}>
            {t('login.codeLabel')}
          </label>
          <div className="flex gap-2">
            <input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otpCode}
              onChange={(e) => { setOtpCode(e.target.value.replace(/[^0-9]/g, '')); setOtpError('') }}
              placeholder="123456"
              className="flex-1 rounded-xl px-4 py-3 text-center text-lg tracking-widest"
              style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#3B2F25' }}
            />
            <button
              type="submit"
              disabled={otpBusy}
              className="rounded-xl px-5 font-semibold transition hover:opacity-90 disabled:opacity-50"
              style={{ background: '#630826', color: '#FDFAF5' }}
            >
              {otpBusy ? t('login.codeChecking') : t('login.codeSubmit')}
            </button>
          </div>
          {otpError && <p className="text-xs mt-2" style={{ color: '#9B2C2C' }}>{otpError}</p>}
          <p className="text-xs mt-2" style={{ color: '#8B6F4E' }}>{t('login.codeWhy')}</p>
        </form>
      </div>
    )
  }

  return (
    <div
      className="rounded-2xl p-6 sm:p-8"
      style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', boxShadow: '0 4px 32px rgba(99,8,38,0.10)' }}
    >
      <button
        type="button"
        onClick={onGoogle}
        disabled={oauthBusy || status === 'sending'}
        className="w-full flex items-center justify-center gap-3 font-medium rounded-xl py-3 transition hover:bg-[#FDFAF5] disabled:opacity-50"
        style={{ background: '#FFFFFF', color: '#630826', border: '1px solid #DDD5C5' }}
      >
        <GoogleIcon />
        {oauthBusy ? t('login.googleRedirecting') : t('login.google')}
      </button>

      <div className="flex items-center gap-3 my-5" aria-hidden="true">
        <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
        <span className="text-xs uppercase tracking-wider" style={{ color: '#8B6F4E' }}>{t('login.or')}</span>
        <div className="flex-1 h-px" style={{ background: '#E8E0D0' }} />
      </div>

      <form onSubmit={onSubmit}>
        <label htmlFor="email" className="block text-sm font-medium mb-2" style={{ color: '#8B6F4E' }}>
          {t('login.emailLabel')}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          maxLength={120}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('login.emailPlaceholder')}
          className="w-full rounded-xl px-4 py-3 mb-4 focus:outline-none transition text-base"
          style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#630826' }}
        />
        {status === 'error' && (
          <div
            className="flex items-start gap-3 mb-4 rounded-xl px-4 py-3"
            style={{ background: '#FBEAE6', border: '1px solid #E8C2B8' }}
          >
            <AlertCircle className="w-4 h-4 flex-none mt-0.5" style={{ color: '#C0392B' }} />
            <p className="text-sm" style={{ color: '#7A2A1F' }}>{errorMsg}</p>
          </div>
        )}
        <button
          type="submit"
          disabled={status === 'sending' || oauthBusy}
          className="w-full flex items-center justify-center gap-2 font-semibold rounded-xl py-3 transition hover:opacity-90 disabled:opacity-50"
          style={{ background: '#630826', color: '#FDFAF5' }}
        >
          {status === 'sending' ? t('login.sending') : <><span>{t('login.sendLink')}</span> <Send className="w-4 h-4" /></>}
        </button>
      </form>
    </div>
  )
}

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
