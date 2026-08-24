'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

// The dashboard's counts, live, and showing what changed since you last looked.
//
// Two problems with a server-rendered number. It is a snapshot from page load, so the screen you
// keep open during an event to watch uploads land stops telling you anything the moment it renders.
// And it answers "what is the number" when the question you actually opened the page with is "what
// happened while I was away".
//
// So each card carries its live value and, next to it, the change since your previous visit.
//
// WHERE THE BASELINE LIVES: this browser, not the database. It needs no schema, cannot be corrupted
// by a failed write, and means the delta always answers "since I last looked, HERE" — which is the
// honest reading of a per-person question. The trade-off is real and worth stating: open the
// dashboard on a phone and the phone keeps its own baseline. For a single admin that is the right
// side of the trade.
//
// The baseline is written ONCE on mount, from the values the page loaded with. So the delta shown
// keeps growing all session as polling brings new numbers in, and your next visit measures from
// where this one started rather than from where it ended.

export type LiveStats = {
  albums: number
  photos: number
  videos: number
  users: number
  subscriptions: number
  openErrors: number
}

const KEY = 'hushare.admin.baseline.v1'
const POLL_MS = 20_000

const CARD = '#FFFDF9'
const BORDER = '#E8E0D0'
const INK = '#2A2118'
const MUTED = '#8A7A68'
const UP = '#2E6B3E'
const ALERT = '#B3261E'

function readBaseline(): Partial<LiveStats> | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) as Partial<LiveStats> : null
  } catch {
    // A private window, cleared site data, or storage disabled entirely. No baseline simply means
    // no deltas this visit — never a broken dashboard.
    return null
  }
}

function writeBaseline(v: LiveStats) {
  try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* ignore */ }
}

// Read ONCE per page and cached, because useSyncExternalStore requires getSnapshot to return a
// stable reference — a fresh object each call is an infinite render loop. Caching is also correct
// here rather than merely convenient: the baseline for this visit is fixed the moment the page
// opens, and the write below deliberately does not change what this visit compares against.
let cachedBaseline: Partial<LiveStats> | null | undefined
function baselineSnapshot(): Partial<LiveStats> | null {
  if (cachedBaseline === undefined) cachedBaseline = readBaseline()
  return cachedBaseline
}
// Nothing to subscribe to: localStorage is not read again after mount.
const subscribeNever = () => () => {}

// Count TO a number rather than snapping to it.
//
// These refresh on their own every twenty seconds, and a figure that silently rewrites itself is
// easy to miss entirely — which defeats the point of making them live. Rolling to the new value
// draws the eye to the thing that moved without anything flashing or jumping.
//
// requestAnimationFrame rather than a CSS transition because there is no CSS property here to
// transition: the thing changing is text content, and only JavaScript can interpolate that.

// Read once. It is a user preference, not a live signal, and calling matchMedia inside the hook
// meant touching the DOM on every render of every card.
let reducedMotion: boolean | undefined
function prefersReducedMotion(): boolean {
  if (reducedMotion === undefined) {
    reducedMotion = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }
  return reducedMotion
}

function useCountUp(target: number, ms = 650): number {
  const [shown, setShown] = useState(target)
  const rafRef = useRef(0)
  // What is on screen RIGHT NOW. A new target arriving mid-roll must continue from where the digits
  // actually are, not from wherever the previous run set out from — otherwise a second update
  // during the first animation makes the number jump backwards before climbing again.
  const shownRef = useRef(target)
  useEffect(() => { shownRef.current = shown }, [shown])

  const reduced = prefersReducedMotion()

  useEffect(() => {
    // Asked for less motion: the value is returned directly below, so there is nothing to animate
    // and nothing to set here.
    if (reduced) return
    const from = shownRef.current
    if (from === target) return

    const started = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / ms)
      // ease-out cubic: quick off the mark, gentle into the new value, so it settles rather than
      // stopping dead on the last frame.
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(Math.round(from + (target - from) * eased))
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, ms, reduced])

  return reduced ? target : shown
}

function Delta({ n, invert }: { n: number; invert?: boolean }) {
  if (!Number.isFinite(n) || n === 0) return null
  // `invert` is for counts where going UP is bad (open errors). Colour follows meaning, not
  // direction, or a rising error count would read as good news in green.
  const good = invert ? n < 0 : n > 0
  return (
    <span style={{ marginLeft: 6, fontSize: 13, fontWeight: 700, color: good ? UP : ALERT }}>
      {n > 0 ? '+' : ''}{n.toLocaleString('en-US')}
    </span>
  )
}

// tabular-nums on the parent keeps the width steady while the digits roll, so nothing beside it
// twitches as the number climbs.
function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value).toLocaleString('en-US')}</>
}

export default function AdminLiveStats({ initial }: { initial: LiveStats }) {
  const [live, setLive] = useState<LiveStats>(initial)
  const [stale, setStale] = useState(false)
  const mounted = useRef(true)

  // The server cannot know what this browser remembers, so it renders no deltas and the client
  // fills them in after hydration. useSyncExternalStore is the mechanism React provides for exactly
  // that server/client split — unlike setState-in-an-effect it does not cascade a render, and React
  // treats the two snapshots as intended rather than as a mismatch to warn about.
  const baseline = useSyncExternalStore(subscribeNever, baselineSnapshot, () => null)

  useEffect(() => {
    mounted.current = true
    // Written from the LOAD values, so the NEXT visit measures from the start of this one — while
    // the delta on screen keeps growing all session, because baselineSnapshot is already cached.
    // Writing on unmount instead would lose it whenever a tab is closed abruptly, which is how
    // tabs are usually closed.
    writeBaseline(initial)
    return () => { mounted.current = false }
    // initial is a server-render snapshot; it does not change for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/stats', { cache: 'no-store' })
      if (!res.ok) { setStale(true); return }
      const data = await res.json() as LiveStats
      if (!mounted.current) return
      setLive(data)
      setStale(false)
    } catch {
      // Offline, or the tab woke from sleep mid-request. Say so rather than showing a number that
      // has quietly stopped being true.
      setStale(true)
    }
  }, [])

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS)
    // Refresh the moment the tab is looked at again, rather than waiting out the interval on a
    // dashboard someone has just switched back to.
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [refresh])

  const cards: { label: string; key: keyof LiveStats; hint?: string; invert?: boolean }[] = [
    { label: 'Active albums', key: 'albums' },
    { label: 'Photos', key: 'photos' },
    { label: 'Videos', key: 'videos' },
    { label: 'Registered users', key: 'users' },
    { label: 'Subscriptions', key: 'subscriptions', hint: 'paid' },
    { label: 'Open errors', key: 'openErrors', invert: true },
  ]

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 10 }}>
        {cards.map(c => {
          const value = live[c.key]
          const was = baseline?.[c.key]
          const delta = typeof was === 'number' ? value - was : 0
          return (
            <div key={c.key} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: INK, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                <CountUp value={value} />
                <Delta n={delta} invert={c.invert} />
              </div>
              {c.hint && <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{c.hint}</div>}
            </div>
          )
        })}
      </div>
      <p style={{ fontSize: 11.5, color: stale ? ALERT : MUTED, margin: '0 0 18px' }}>
        {stale
          ? 'Live updates paused — could not reach the server. These numbers may be out of date.'
          : baseline
            ? 'Updating live. The green figure is what has changed since your last visit; it resets when you next open this page.'
            : 'Updating live. Changes since your last visit will show here from your next visit onward.'}
      </p>
    </>
  )
}
