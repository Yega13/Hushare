'use client'

import { useEffect, useState } from 'react'

// WHO IS SIGNED IN, AND WHAT DOES THEIR PICTURE LOOK LIKE — asked ONCE, answered together.
//
// This replaces a hook that fetched only the picture, alongside a component that separately fetched
// the same endpoint for the sign-in state. That arrangement produced the "account turns into an
// icon" flicker the owner reported, in three steps:
//
//   1. loading      — a transparent "Sign in" placeholder, text-width
//   2. signed-in    — the word "Account" plus a generic circle icon; the picture cannot have
//                     arrived yet, because the avatar fetch was GATED on this render happening
//   3. picture in   — CSS hides the word, the photo replaces the icon
//
// Three different shapes in the same slot, each one shifting the layout, because two calls to the
// same endpoint were made in sequence rather than one call answering both questions. /api/me has
// always returned signedIn and avatarUrl in the same response.
//
// It also fetched /api/me TWICE per page for a signed-in visitor — the avatar hook memoised its own
// promise, but the component's raw fetch went around that cache entirely. Each of those does a
// Supabase round trip plus a subscription lookup plus a profile query.

export type AccountStatus = 'loading' | 'signed-out' | 'signed-in'

export type AccountIdentity = {
  status: AccountStatus
  avatarUrl: string | null
}

type MeResponse = { signedIn?: boolean; avatarUrl?: string | null }

let cached: Promise<AccountIdentity> | null = null

// Everything currently showing an identity. Told to re-ask when the cache is cleared, so a sign-out
// in another tab updates this one without a page reload — the first version of this reloaded the
// page instead, which would have restarted an upload every time the auth token refreshed.
const listeners = new Set<() => void>()

/** Forget the cached identity and re-ask — after changing the picture, or on a sign-in/sign-out. */
export function clearAccountIdentityCache(): void {
  cached = null
  listeners.forEach((notify) => notify())
}

function load(): Promise<AccountIdentity> {
  if (!cached) {
    cached = fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() as Promise<MeResponse> : null))
      .then((j): AccountIdentity => ({
        // signedIn, NOT the HTTP status. The previous version watched for a 401 that this endpoint
        // never sends — it answers 200 with signedIn:false — so a visitor whose session had expired
        // kept seeing "Account" and was bounced to /login when they clicked it.
        status: j?.signedIn ? 'signed-in' : 'signed-out',
        avatarUrl: j?.avatarUrl ?? null,
      }))
      // A failed lookup resolves to signed-out rather than rejecting: this is a nav control, and it
      // must never surface as an error or sit in a loading state forever. Signed-out is the safe
      // answer — /account redirects anyone who is actually signed in straight back in.
      .catch((): AccountIdentity => ({ status: 'signed-out', avatarUrl: null }))
  }
  return cached
}

/**
 * Both answers in one state transition: loading, then the final shape.
 *
 * `enabled: false` keeps it at 'loading' and makes no request — for a control that is not rendered
 * on this breakpoint and should not be paying for the lookup.
 */
export function useAccountIdentity(enabled = true): AccountIdentity {
  const [identity, setIdentity] = useState<AccountIdentity>({ status: 'loading', avatarUrl: null })

  useEffect(() => {
    if (!enabled) return
    let alive = true
    const refresh = () => { void load().then((v) => { if (alive) setIdentity(v) }) }
    refresh()
    listeners.add(refresh)
    return () => { alive = false; listeners.delete(refresh) }
  }, [enabled])

  return identity
}
