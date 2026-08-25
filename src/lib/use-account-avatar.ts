'use client'

import { useEffect, useState } from 'react'

// The signed-in account's picture, fetched ONCE per page load however many things ask for it.
//
// Two separate controls want it — the nav link and the compact account button on mobile — and they
// are rendered by different components that never meet. Without a shared cache each would fetch
// /api/me on every page, which is the kind of duplication that starts as one extra request and ends
// as four. The promise is memoised at module scope, so the second caller awaits the first caller's
// request rather than making its own.
//
// A module-level cache is deliberately NOT a store: it lives for the lifetime of the page, and a
// full navigation clears it. That is the right lifetime for something the server can change — a
// stale picture until the next hard load is a fair price for not polling.

let cached: Promise<string | null> | null = null

/** Forget the cached picture — call after changing it so the nav updates without a reload. */
export function clearAvatarCache(): void {
  cached = null
}

function load(): Promise<string | null> {
  if (!cached) {
    cached = fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { avatarUrl?: string | null } | null) => j?.avatarUrl ?? null)
      // A failed lookup resolves to "no picture" rather than rejecting: this is decoration on a nav
      // bar, and it must never surface as an error or leave a control in a loading state forever.
      .catch(() => null)
  }
  return cached
}

export function useAccountAvatar(enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let alive = true
    void load().then((u) => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [enabled])

  return url
}
