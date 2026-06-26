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
    const timerIds = new Set<ReturnType<typeof setTimeout>>()

    function push(message: string, type: AppToastType = 'success') {
      const id = Date.now() + Math.random()
      setToasts((current) => [...current, { id, message, type }].slice(-3))
      const timerId = setTimeout(() => {
        timerIds.delete(timerId)
        setToasts((current) => current.filter((toast) => toast.id !== id))
      }, 3200)
      timerIds.add(timerId)
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
      timerIds.forEach((id) => clearTimeout(id))
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[90] flex flex-col gap-2" style={{ width: 'min(calc(100vw - 2rem), 360px)' }}>
      {toasts.map((toast) => {
        const isError = toast.type === 'error'
        const Icon = isError ? AlertCircle : CheckCircle2
        return (
          <div
            key={toast.id}
            className="hush-menu-pop flex items-start gap-2 rounded-xl px-3 py-3 text-sm shadow-xl"
            style={{
              background: isError ? '#FBEAE6' : '#FFFFFF',
              border: `1px solid ${isError ? '#E8C2B8' : '#DDD5C5'}`,
              color: isError ? '#7A2A1F' : '#254F22',
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
