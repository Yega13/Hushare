'use client'

import { useEffect, useState } from 'react'
import Script from 'next/script'
import { AlertCircle, CheckCircle2, Send } from 'lucide-react'

type Status = 'idle' | 'sending' | 'sent' | 'error'

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

const REPORT_REASONS = [
  'Illegal or abusive content',
  'Harassment or privacy concern',
  'Spam, scam, or phishing',
  'Copyright or ownership issue',
  'Other',
]

declare global {
  interface Window {
    turnstile?: {
      reset: (widget?: string) => void
    }
  }
}

export default function ReportForm() {
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [reason, setReason] = useState(REPORT_REASONS[0])
  const [details, setDetails] = useState('')
  const [albumTitle, setAlbumTitle] = useState('')
  const [albumUrl, setAlbumUrl] = useState('')
  const [albumSlug, setAlbumSlug] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setAlbumTitle(params.get('album') ?? '')
    setAlbumUrl(params.get('url') ?? '')
    setAlbumSlug(params.get('slug') ?? '')
    setStatus('idle')
    setErrorMsg('')
  }, [])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === 'sending') return

    const form = e.currentTarget
    const data = new FormData(form)

    if (data.get('website')) {
      setStatus('sent')
      form.reset()
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
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          albumTitle,
          albumUrl,
          albumSlug,
          reason,
          details: details.trim(),
          reporterEmail: String(data.get('reporterEmail') ?? '').trim(),
          turnstileToken,
        }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Request failed (${res.status})`)
      }

      setStatus('sent')
      form.reset()
      setReason(REPORT_REASONS[0])
      setDetails('')
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
        className="hush-modal-pop rounded-2xl p-8 text-center"
        style={{ background: '#F6E9EE', border: '1px solid #C8D6C2' }}
      >
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10" style={{ color: '#630826' }} />
        <h2 className="mb-2 text-xl font-bold" style={{ color: '#630826', fontFamily: 'var(--font-serif)' }}>
          Report sent
        </h2>
        <p className="text-sm" style={{ color: '#5C4A3C' }}>
          Thank you. We will review this album as soon as possible.
        </p>
        <button
          type="button"
          onClick={() => setStatus('idle')}
          className="hush-press mt-5 text-sm font-semibold hover:underline"
          style={{ color: '#630826' }}
        >
          Send another report
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
        className="hush-support-form rounded-2xl p-6 sm:p-8"
        style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', boxShadow: '0 4px 32px rgba(99,8,38,0.10)' }}
      >
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}>
          <label htmlFor="hp-website">Website (leave blank)</label>
          <input id="hp-website" type="text" name="website" tabIndex={-1} autoComplete="off" />
        </div>

        {(albumTitle || albumUrl) && (
          <div className="mb-5 rounded-xl px-4 py-3" style={{ background: '#F8F1E6', border: '1px solid #E8E0D0' }}>
            <p className="text-xs font-semibold uppercase" style={{ color: '#8B6F4E', letterSpacing: '0.12em' }}>
              Reporting
            </p>
            {albumTitle && <p className="mt-1 font-semibold" style={{ color: '#630826' }}>{albumTitle}</p>}
            {albumUrl && <p className="mt-1 break-all text-xs" style={{ color: '#7C5C3E' }}>{albumUrl}</p>}
          </div>
        )}

        <fieldset className="mb-5">
          <legend className="mb-3 block text-sm font-medium" style={{ color: '#8B6F4E' }}>
            Reason <span style={{ color: '#C0392B' }}>*</span>
          </legend>
          <div className="grid gap-2">
            {REPORT_REASONS.map((item) => (
              <label
                key={item}
                className="flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition"
                style={{
                  background: reason === item ? '#F6E9EE' : '#FDFAF5',
                  border: reason === item ? '1px solid #9DBB99' : '1px solid #DDD5C5',
                  color: '#630826',
                }}
              >
                <input
                  type="radio"
                  name="reason"
                  value={item}
                  checked={reason === item}
                  onChange={() => setReason(item)}
                  className="h-4 w-4"
                />
                {item}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mb-4">
          <label htmlFor="report-details" className="mb-2 block text-sm font-medium" style={{ color: '#8B6F4E' }}>
            Details {reason === 'Other' ? <span style={{ color: '#C0392B' }}>*</span> : <span style={{ color: '#B0A090' }}>(optional)</span>}
          </label>
          <textarea
            id="report-details"
            name="details"
            rows={6}
            required={reason === 'Other'}
            maxLength={4000}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Tell us what is wrong with this album."
            className="w-full resize-y rounded-xl px-4 py-3 text-base transition focus:outline-none"
            style={{ minHeight: '140px', background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#630826' }}
          />
        </div>

        <div className="mb-5">
          <label htmlFor="reporter-email" className="mb-2 block text-sm font-medium" style={{ color: '#8B6F4E' }}>
            Your email <span style={{ color: '#B0A090' }}>(optional)</span>
          </label>
          <input
            id="reporter-email"
            name="reporterEmail"
            type="email"
            autoComplete="email"
            maxLength={120}
            className="w-full rounded-xl px-4 py-3 text-base transition focus:outline-none"
            style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#630826' }}
          />
        </div>

        {TURNSTILE_SITE_KEY && (
          <div className="cf-turnstile mb-4" data-sitekey={TURNSTILE_SITE_KEY} data-theme="light" data-size="normal" />
        )}

        {status === 'error' && (
          <div role="alert" aria-live="polite" aria-atomic="true" className="mb-4 flex items-start gap-3 rounded-xl px-4 py-3" style={{ background: '#FBEAE6', border: '1px solid #E8C2B8' }}>
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" style={{ color: '#C0392B' }} />
            <div className="text-sm" style={{ color: '#7A2A1F' }}>
              <p className="mb-0.5 font-semibold">Couldn&apos;t send the report</p>
              <p>{errorMsg}. You can also email husharesupport@gmail.com directly.</p>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={status === 'sending'}
          className="hush-press flex w-full items-center justify-center gap-2 rounded-xl py-3 font-semibold transition hover:opacity-90 disabled:opacity-50"
          style={{ background: '#8A0032', color: '#FDFAF5' }}
        >
          {status === 'sending' ? 'Sending...' : <>Send urgent report <Send className="h-4 w-4" /></>}
        </button>
      </form>
    </>
  )
}
