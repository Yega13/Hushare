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
  // Backup freshness. NOT a card: it is not a count, and forcing it into one would give it a
  // CountUp animation and a green delta, which is absurd for "hours since the database was last
  // copied somewhere else". It gets its own line, and that line turns red.
  lastBackupAt?: string | null
  backupAgeHours?: number | null
  backupStale?: boolean
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

// `from` is where the roll STARTS on first render — the value at your last visit. Without it the
// count-up only ever fired when a number happened to change while you were watching, which on a
// twenty-second poll means almost never: you upload, then open the dashboard, and by the time it
// renders the number is already correct and there is nothing to animate. Starting from the baseline
// means the climb IS the delta, played every time the page opens, which is what the figure was for.
function useCountUp(target: number, from?: number, ms = 900): number {
  // Starts AT the target, not at the baseline. useSyncExternalStore returns the SERVER snapshot for
  // the hydration render, so `from` is undefined on render #1 and a lazy initialiser would lock the
  // value in before the baseline ever arrives — which is exactly why the climb never played. The
  // effect below opens from `from` on its first run instead, once it exists.
  const [shown, setShown] = useState(target)
  const rafRef = useRef(0)
  // What is on screen RIGHT NOW. A new target arriving mid-roll must continue from where the digits
  // actually are, not from wherever the previous run set out from — otherwise a second update
  // during the first animation makes the number jump backwards before climbing again.
  const shownRef = useRef(target)
  useEffect(() => { shownRef.current = shown }, [shown])

  const reduced = prefersReducedMotion()

  // First run opens from the last-visit baseline; later runs continue from whatever is on screen.
  const firstRun = useRef(true)

  useEffect(() => {
    // Asked for less motion: the value is returned directly below, so there is nothing to animate
    // and nothing to set here.
    if (reduced) return
    const origin = firstRun.current && typeof from === 'number' ? from : shownRef.current
    firstRun.current = false
    if (origin === target) return

    const started = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / ms)
      // ease-out cubic: quick off the mark, gentle into the new value, so it settles rather than
      // stopping dead on the last frame.
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(Math.round(origin + (target - origin) * eased))
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, ms, reduced, from])

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
function CountUp({ value, from }: { value: number; from?: number }) {
  return <>{useCountUp(value, from).toLocaleString('en-US')}</>
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

  // Only the COUNTS get a card. Keyed off a narrowed union rather than `keyof LiveStats`, so
  // adding a non-numeric stat (backup freshness, below) cannot silently end up rendered
  // through CountUp — it fails to compile instead.
  type CountKey = 'albums' | 'photos' | 'videos' | 'users' | 'subscriptions' | 'openErrors'
  const cards: { label: string; key: CountKey; hint?: string; invert?: boolean }[] = [
    { label: 'Active albums', key: 'albums' },
    { label: 'Photos', key: 'photos' },
    { label: 'Videos', key: 'videos' },
    { label: 'Registered users', key: 'users' },
    { label: 'Subscriptions', key: 'subscriptions', hint: 'paid' },
    { label: 'Open errors', key: 'openErrors', invert: true },
  ]

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 12, marginBottom: 10 }}>
        {cards.map(c => {
          const value = live[c.key]
          const was = baseline?.[c.key]
          const delta = typeof was === 'number' ? value - was : 0
          return (
            <div key={c.key} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: INK, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                <CountUp value={value} from={typeof was === 'number' ? was : undefined} />
                <Delta n={delta} invert={c.invert} />
              </div>
              {c.hint && <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{c.hint}</div>}
            </div>
          )
        })}
      </div>
      {/* THE BACKUP LINE.
          Supabase's free plan takes no backups, so the only copies are the ones this product makes
          for itself. The nightly job failed silently on 25 and 26 August — the dump ran, the upload
          exited on missing credentials, and the copy was thrown away with the runner — and nobody
          knew for two days because nothing said so anywhere the owner looks. This is that place. */}
      {live.backupStale !== undefined && (
        <p
          style={{
            fontSize: 12,
            fontWeight: live.backupStale ? 700 : 400,
            color: live.backupStale ? ALERT : MUTED,
            margin: '0 0 10px',
          }}
        >
          {live.lastBackupAt == null
            ? 'No database backup has ever completed. Supabase takes none of its own — right now there is no off-machine copy.'
            : live.backupStale
              ? `Last database backup was ${live.backupAgeHours}h ago. The nightly job runs at 03:15 UTC, so a night has been missed.`
              : `Database backed up ${live.backupAgeHours}h ago.`}
        </p>
      )}
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
