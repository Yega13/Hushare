'use client'

import { useRef, useState } from 'react'
import { Lock } from 'lucide-react'

type Props = {
  slug: string
  title: string
  onUnlocked: () => void
}

export default function PasswordGate({ slug, title, onUnlocked }: Props) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const clearedAutofillRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit() {
    if (submitting || !password) return
    setSubmitting(true)
    setError('')

    // Guard against setSubmitting being called after onUnlocked() unmounts this component.
    // onUnlocked() triggers parent state changes that unmount PasswordGate; the finally
    // block would then call setSubmitting on an unmounted component without this flag.
    let unlocked = false

    try {
      const res = await fetch('/api/album/password/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, password }),
      })
      const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string }

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') ?? '300', 10)
        const mins = Math.max(1, Math.ceil(retryAfter / 60))
        setError(`Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`)
        inputRef.current?.focus()
        return
      }

      if (!res.ok || !body.ok) {
        setError(body.error ?? 'Incorrect password')
        inputRef.current?.focus()
        return
      }

      unlocked = true
      onUnlocked()
    } catch {
      setError('Network error. Please try again.')
      inputRef.current?.focus()
    } finally {
      if (!unlocked) setSubmitting(false)
    }
  }

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-6 text-center"
      style={{ background: '#630826', color: '#FDFAF5' }}
    >
      <div className="w-full max-w-sm">
        <Lock className="w-8 h-8 mx-auto mb-4" style={{ opacity: 0.9 }} aria-hidden="true" />
        <p
          className="text-xs font-medium uppercase mb-2"
          style={{ letterSpacing: '0.18em', opacity: 0.75 }}
        >
          Password protected
        </p>
        <h1 className="text-2xl font-bold mb-6" style={{ fontFamily: 'var(--font-serif)' }}>
          {title}
        </h1>

        <div className="flex flex-col gap-3">
          {/* Hidden field hints password managers to associate credentials with this album */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={slug}
            readOnly
            aria-hidden="true"
            className="hidden"
          />

          <input
            ref={inputRef}
            type="password"
            aria-label="Album password"
            name={`hush-visitor-password-${slug}`}
            autoComplete="current-password"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            placeholder="Enter password"
            maxLength={128}
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void handleSubmit()}
            onFocus={() => {
              if (!clearedAutofillRef.current) {
                clearedAutofillRef.current = true
                // setPassword('') schedules a React re-render with value="",
                // which is sufficient to clear any autofill value.
                setPassword('')
              }
            }}
            className="w-full rounded-xl px-4 py-3 text-base focus:outline-none"
            style={{
              background: 'rgba(253,250,245,0.10)',
              border: '1px solid rgba(253,250,245,0.30)',
              color: '#FDFAF5',
            }}
          />

          {error && (
            <p role="alert" className="text-sm" style={{ color: '#F3D8C7' }}>
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || !password}
            className="w-full rounded-xl py-3 font-semibold transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#FDFAF5', color: '#630826' }}
          >
            {submitting ? 'Checking…' : 'Unlock album'}
          </button>
        </div>
      </div>
    </div>
  )
}
