'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'

export type AppToastType = 'success' | 'error'

type Toast = {
  id: number
  message: string
  type: AppToastType
}

export const APP_TOAST_EVENT = 'hush-app-toast'
export const APP_TOAST_STORAGE_KEY = 'hush-app-toast'

export function showAppToast(message: string, type: AppToastType = 'success') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(APP_TOAST_EVENT, { detail: { message, type } }))
}

export function storeAppToast(message: string, type: AppToastType = 'success') {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(APP_TOAST_STORAGE_KEY, JSON.stringify({ message, type }))
  } catch { /* storage blocked in Safari private mode */ }
}

export default function AppToastViewport() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    // Keyed by type+message so identical messages collapse into ONE toast. Uploads are the case
    // that forced this: a dropped connection fails many files for the same reason, and each retry
    // is its own batch with its own dedupe, so the same sentence stacked up the screen three at a
    // time. Two genuinely different problems still get a toast each — the key includes the message,
    // so only true repeats collapse. Insertion-ordered, which is what makes the eviction below pick
    // the oldest. Living here rather than in the uploader fixes it for every caller in the app.
    const visible = new Map<string, { id: number; timerId: ReturnType<typeof setTimeout> }>()
    const MAX_VISIBLE = 3
    const DISMISS_MS = 3200

    function schedule(key: string, id: number) {
      return setTimeout(() => {
        visible.delete(key)
        setToasts((current) => current.filter((toast) => toast.id !== id))
      }, DISMISS_MS)
    }

    function drop(key: string, entry: { id: number; timerId: ReturnType<typeof setTimeout> }) {
      clearTimeout(entry.timerId)
      visible.delete(key)
      setToasts((current) => current.filter((toast) => toast.id !== entry.id))
    }

    function push(message: string, type: AppToastType = 'success') {
      const key = `${type}:${message}`
      const existing = visible.get(key)
      if (existing) {
        // Already on screen. Restart its clock instead of adding a second copy, so a repeating
        // failure keeps the message up for as long as it keeps happening rather than expiring
        // mid-incident — one toast that persists, not a column of duplicates.
        clearTimeout(existing.timerId)
        existing.timerId = schedule(key, existing.id)
        return
      }
      const id = Date.now() + Math.random()
      visible.set(key, { id, timerId: schedule(key, id) })
      // Cap explicitly rather than with slice(-3) in the updater: a toast dropped by slice kept its
      // timer AND its `visible` entry, so the app still believed it was on screen and silently
      // swallowed its next occurrence. Evicting properly keeps the map honest about what is shown.
      while (visible.size > MAX_VISIBLE) {
        const oldestKey = visible.keys().next().value
        if (oldestKey === undefined || oldestKey === key) break
        const oldest = visible.get(oldestKey)
        if (!oldest) break
        drop(oldestKey, oldest)
      }
      setToasts((current) => [...current, { id, message, type }])
    }

    // Guard sessionStorage access — throws SecurityError in Safari private mode.
    let stored: string | null = null
    try {
      stored = window.sessionStorage.getItem(APP_TOAST_STORAGE_KEY)
    } catch { /* storage blocked — skip */ }
    if (stored) {
      try { window.sessionStorage.removeItem(APP_TOAST_STORAGE_KEY) } catch { /* ignore */ }
      try {
        const parsed = JSON.parse(stored) as { message?: string; type?: AppToastType }
        if (parsed.message) push(parsed.message, parsed.type ?? 'success')
      } catch {
        push(stored)
      }
    }

    function onToast(event: Event) {
      const detail = (event as CustomEvent<{ message?: string; type?: AppToastType }>).detail
      if (detail?.message) push(detail.message, detail.type ?? 'success')
    }

    window.addEventListener(APP_TOAST_EVENT, onToast)
    return () => {
      window.removeEventListener(APP_TOAST_EVENT, onToast)
      visible.forEach((entry) => clearTimeout(entry.timerId))
      visible.clear()
    }
  }, [])

  // z-400 must stay ABOVE every overlay in the app, or an error message is painted behind the
  // thing that caused it. At z-90 it sat under the Album Designer (zIndex 120), the share menu and
  // photo modals (200/210) and the owner sheets — so a failed save inside the Designer rolled the
  // change back with its explanation invisible, which reads as "the button did nothing". That is
  // exactly how the sponsor reorder became undiagnosable.
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[400] flex flex-col gap-2" style={{ width: 'min(calc(100vw - 2rem), 360px)' }}>
      {toasts.map((toast) => {
        const isError = toast.type === 'error'
        const Icon = isError ? AlertCircle : CheckCircle2
        return (
          <div
            key={toast.id}
            className="hush-menu-pop flex items-start gap-2 rounded-xl px-3 py-3 text-sm shadow-xl"
            style={{
              // Semantic status colours (green = success, red = error) are kept conventional and
              // independent of the burgundy brand accent, so the two toasts read unmistakably.
              background: isError ? '#FBEAE6' : '#ECF5EA',
              border: `1px solid ${isError ? '#E8C2B8' : '#C6DFC0'}`,
              color: isError ? '#7A2A1F' : '#1E4A1C',
            }}
          >
            <Icon className="mt-0.5 h-4 w-4 flex-none" />
            <span>{toast.message}</span>
          </div>
        )
      })}
    </div>
  )
}
