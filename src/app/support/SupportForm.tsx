'use client'

import { useEffect, useState } from 'react'
import Script from 'next/script'
import { Send, CheckCircle2, AlertCircle } from 'lucide-react'

type Status = 'idle' | 'sending' | 'sent' | 'error'

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

declare global {
  interface Window {
    turnstile?: {
      reset: (widget?: string) => void
    }
  }
}

export default function SupportForm() {
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setSubject(params.get('subject') ?? '')
    setMessage(params.get('message') ?? '')
  }, [])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === 'sending') return

    const form = e.currentTarget
    const data = new FormData(form)

    // Honeypot — bots fill this, real users don't see it. Pretend success.
    if (data.get('website')) {
      setStatus('sent')
      form.reset()
      setSubject('')
      setMessage('')
      return
    }

    const turnstileToken = String(data.get('cf-turnstile-response') ?? '')
    if (!turnstileToken && TURNSTILE_SITE_KEY) {
      setStatus('error')
      setErrorMsg('Please wait for the verification to finish before sending')
      return
    }

    setStatus('sending')
    setErrorMsg('')

    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(data.get('name') ?? '').trim(),
          email: String(data.get('email') ?? '').trim(),
          subject: String(data.get('subject') ?? '').trim(),
          message: String(data.get('message') ?? '').trim(),
          turnstileToken,
        }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Request failed (${res.status})`)
      }

      setStatus('sent')
      form.reset()
      setSubject('')
      setMessage('')
      window.turnstile?.reset()
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
      window.turnstile?.reset()
    }
  }

  if (status === 'sent') {
    return (
      <div
        role="alert"
        aria-live="polite"
        aria-atomic="true"
        className="hush-modal-pop hush-support-success rounded-2xl p-8 text-center"
        style={{ background: '#EAF0E8', border: '1px solid #C8D6C2' }}
      >
        <CheckCircle2 className="w-10 h-10 mx-auto mb-3" style={{ color: '#254F22' }} />
        <h3
          className="text-xl font-bold mb-2"
          style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}
        >
          Message sent
        </h3>
        <p className="text-sm" style={{ color: '#5C4A3C' }}>
          Thanks - we&apos;ll reply to your inbox within one business day.
        </p>
        <button
          type="button"
          onClick={() => setStatus('idle')}
          className="hush-press mt-5 text-sm font-semibold hover:underline"
          style={{ color: '#254F22' }}
        >
          Send another message
        </button>
      </div>
    )
  }

  return (
    <>
      {TURNSTILE_SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          async
          defer
          strategy="afterInteractive"
        />
      )}
      <form
        onSubmit={onSubmit}
        className="hush-hover-lift hush-support-form rounded-2xl p-6 sm:p-8"
        style={{
          background: '#FFFFFF',
          border: '1px solid #DDD5C5',
          boxShadow: '0 4px 32px rgba(37,79,34,0.10)',
        }}
      >
        {/* Honeypot - hidden from real users and assistive tech */}
        <div
          aria-hidden="true"
          style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}
        >
          <label htmlFor="hp-website">Website (leave blank)</label>
          <input id="hp-website" type="text" name="website" tabIndex={-1} autoComplete="off" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-2" style={{ color: '#8B6F4E' }}>
              Your name <span style={{ color: '#B0A090' }}>(optional)</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              maxLength={80}
              className="w-full rounded-xl px-4 py-3 focus:outline-none transition text-base"
              style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-2" style={{ color: '#8B6F4E' }}>
              Your email <span style={{ color: '#C0392B' }}>*</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              maxLength={120}
              className="w-full rounded-xl px-4 py-3 focus:outline-none transition text-base"
              style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
            />
          </div>
        </div>

        <div className="mb-4">
          <label htmlFor="subject" className="block text-sm font-medium mb-2" style={{ color: '#8B6F4E' }}>
            Subject <span style={{ color: '#B0A090' }}>(optional)</span>
          </label>
          <input
            id="subject"
            name="subject"
            type="text"
            maxLength={120}
            placeholder="e.g. I lost my owner link for an album"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-xl px-4 py-3 focus:outline-none transition text-base"
            style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
          />
        </div>

        <div className="mb-5">
          <label htmlFor="message" className="block text-sm font-medium mb-2" style={{ color: '#8B6F4E' }}>
            Message <span style={{ color: '#C0392B' }}>*</span>
          </label>
          <textarea
            id="message"
            name="message"
            required
            rows={6}
            maxLength={4000}
            placeholder="Tell us what's going on. Album link, screenshots, anything that helps."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full rounded-xl px-4 py-3 focus:outline-none transition text-base resize-y"
            style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22', minHeight: '140px' }}
          />
        </div>

        {TURNSTILE_SITE_KEY && (
          <div className="mb-4">
            <div
              className="cf-turnstile"
              data-sitekey={TURNSTILE_SITE_KEY}
              data-theme="light"
              data-size="normal"
            />
          </div>
        )}

        {status === 'error' && (
          <div
            role="alert"
            aria-live="polite"
            aria-atomic="true"
            className="flex items-start gap-3 mb-4 rounded-xl px-4 py-3"
            style={{ background: '#FBEAE6', border: '1px solid #E8C2B8' }}
          >
            <AlertCircle className="w-4 h-4 flex-none mt-0.5" style={{ color: '#C0392B' }} />
            <div className="text-sm" style={{ color: '#7A2A1F' }}>
              <p className="font-semibold mb-0.5">Couldn&apos;t send your message</p>
              <p>
                {errorMsg}. You can also email us directly at{' '}
                <a href="mailto:husharesupport@gmail.com" className="underline" style={{ color: '#7A2A1F' }}>
                  husharesupport@gmail.com
                </a>
                .
              </p>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={status === 'sending'}
          className="hush-press w-full flex items-center justify-center gap-2 font-semibold rounded-xl py-3 transition hover:opacity-90 disabled:opacity-50"
          style={{ background: '#254F22', color: '#FDFAF5' }}
        >
          {status === 'sending' ? (
            'Sending...'
          ) : (
            <>
              Send message <Send className="w-4 h-4" />
            </>
          )}
        </button>
      </form>
    </>
  )
}
