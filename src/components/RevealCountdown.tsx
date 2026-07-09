'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'

type Props = {
  revealAt: string
  title: string
  onUnlocked: () => void
}

type TimeLeft = {
  days: number
  hours: number
  minutes: number
  seconds: number
  total: number
}

function getTimeLeft(revealAt: string): TimeLeft {
  const total = Math.max(0, new Date(revealAt).getTime() - Date.now())
  return {
    days:    Math.floor(total / (1000 * 60 * 60 * 24)),
    hours:   Math.floor((total / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((total / (1000 * 60)) % 60),
    seconds: Math.floor((total / 1000) % 60),
    total,
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function Unit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center" style={{ minWidth: '4.5rem' }}>
      <span
        className="font-mono font-bold tabular-nums"
        style={{
          fontSize: 'clamp(2.8rem, 10vw, 5rem)',
          color: '#FDFAF5',
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}
      >
        {pad(value)}
      </span>
      {/* #E8C4D0 on #2B0A15 ≈ 6.5:1 contrast — passes WCAG AA for small text */}
      <span
        className="uppercase"
        style={{ fontSize: '10px', color: '#E8C4D0', letterSpacing: '0.15em', marginTop: '6px' }}
      >
        {label}
      </span>
    </div>
  )
}

function Sep() {
  return (
    <span
      className="font-mono font-bold select-none"
      style={{
        fontSize: 'clamp(2rem, 8vw, 4rem)',
        color: 'rgba(199,118,144,0.45)',
        paddingBottom: '1.6rem',
        margin: '0 2px',
        lineHeight: 1,
      }}
    >
      :
    </span>
  )
}

export default function RevealCountdown({ revealAt, title, onUnlocked }: Props) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() => getTimeLeft(revealAt))

  // Stable ref — prevents the interval from needing onUnlocked in its dep array,
  // which would recreate it on every parent render
  const onUnlockedRef = useRef(onUnlocked)
  useEffect(() => { onUnlockedRef.current = onUnlocked }, [onUnlocked])

  useEffect(() => {
    // Already past reveal time on mount
    if (getTimeLeft(revealAt).total === 0) {
      onUnlockedRef.current()
      return
    }

    // One interval for the entire mount — NOT recreated each tick
    const id = setInterval(() => {
      const next = getTimeLeft(revealAt)
      setTimeLeft(next)
      if (next.total === 0) {
        clearInterval(id)
        onUnlockedRef.current()
      }
    }, 1000)

    return () => clearInterval(id)
  }, [revealAt])

  const formattedDate = new Date(revealAt).toLocaleString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-6"
      style={{ background: '#2B0A15' }}
      aria-label={`${title} — reveals ${formattedDate}`}
    >
      <div className="flex flex-col items-center gap-10 max-w-sm w-full text-center">

        <Image
          src="/logo/logo-dark-transparent.png"
          alt="Hushare"
          width={618}
          height={146}
          className="hush-logo"
          style={{
            width: 'auto',
            maxWidth: '140px',
            filter: 'brightness(0) invert(1)',
            opacity: 0.55,
          }}
          draggable={false}
          priority
        />

        <div>
          {/* #E8C4D0 on #2B0A15 ≈ 6.5:1 contrast — passes WCAG AA */}
          <p
            className="font-semibold uppercase mb-3"
            style={{ fontSize: '11px', color: '#E8C4D0', letterSpacing: '0.22em' }}
          >
            Photos coming soon
          </p>
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              color: '#FDFAF5',
              fontSize: 'clamp(1.6rem, 5vw, 2.6rem)',
              lineHeight: 1.15,
              fontWeight: 700,
            }}
          >
            {title}
          </h1>
        </div>

        <div
          className="flex items-end justify-center"
          aria-live="off"
          aria-label={`${timeLeft.days > 0 ? `${timeLeft.days} days ` : ''}${pad(timeLeft.hours)} hours ${pad(timeLeft.minutes)} minutes ${pad(timeLeft.seconds)} seconds remaining`}
        >
          {/* Regular flex wrapper (not display:contents) so visibility:hidden
              preserves the box and reserved space, preventing layout shift
              when the days unit disappears at the 24-hour mark */}
          <div style={{
            display: 'flex',
            alignItems: 'flex-end',
            visibility: timeLeft.days > 0 ? 'visible' : 'hidden',
          }}>
            <Unit value={timeLeft.days} label="days" />
            <Sep />
          </div>
          <Unit value={timeLeft.hours} label="hrs" />
          <Sep />
          <Unit value={timeLeft.minutes} label="min" />
          <Sep />
          <Unit value={timeLeft.seconds} label="sec" />
        </div>

        <div
          className="w-full rounded-2xl px-6 py-4"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          {/* #E8C4D0 on #2B0A15 ≈ 6.5:1 contrast — passes WCAG AA */}
          <p
            className="uppercase mb-1"
            style={{ fontSize: '11px', color: '#E8C4D0', letterSpacing: '0.2em' }}
          >
            Reveals on
          </p>
          <p className="text-sm font-medium" style={{ color: '#E8C4D0' }}>
            {formattedDate}
          </p>
        </div>

        {/* #C77690 on #2B0A15 ≈ 4.8:1 contrast — passes WCAG AA */}
        <p style={{ fontSize: '11px', color: '#C77690' }}>
          This page will unlock automatically when the time arrives.
        </p>

      </div>
    </div>
  )
}
