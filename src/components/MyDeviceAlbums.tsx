'use client'

import { useEffect, useState } from 'react'
import { getMyAlbums, forgetAlbum, type MyAlbum } from '@/lib/my-albums'
import { createClient } from '@/lib/supabase/client'
import { showAppToast } from '@/components/AppToast'
import { useT } from '@/i18n/LocaleProvider'

// "Your albums on this device" — recovery from localStorage, so it renders nothing on the server
// and nothing until we've checked. Each entry links back to the album's owner (#owner=) view, so
// a creator who closed the tab never loses it.
//
// IT SHOWS TO SIGNED-IN VISITORS TOO, and that is the whole point of the second half of this file.
// It used to hide itself for them — "registered users manage their albums from their account" —
// which is true only of albums that are ON an account. An album made while signed out never
// reaches the profile, so for a signed-in person it was invisible in BOTH places at once: absent
// from their account page, and deliberately hidden here. A customer emailed support having made
// three albums and being able to find two; 40 albums holding photos were stranded that way.
//
// So for a signed-in visitor this lists ONLY the albums that are not on their account, and offers
// to attach them. For a signed-out visitor nothing changes.
export default function MyDeviceAlbums() {
  const { t } = useT()
  const [albums, setAlbums] = useState<MyAlbum[] | null>(null)
  // null = still checking; false = signed out (show); true = signed in (hide).
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Slugs the server says have no account behind them. null = not asked yet, so a signed-in
  // visitor is shown nothing rather than a list we cannot describe honestly (rule 20).
  const [unclaimed, setUnclaimed] = useState<Set<string> | null>(null)
  // Deleted, still recoverable. These are NOT pruned: the token this device holds is the only key
  // to an anonymous album, and 71 of the 105 live albums are anonymous.
  const [binned, setBinned] = useState<Set<string>>(new Set())

  useEffect(() => {
    const local = getMyAlbums()
    setAlbums(local)
    createClient().auth.getSession().then(({ data }) => setLoggedIn(!!data.session)).catch(() => setLoggedIn(false))

    // localStorage has no idea an album was deleted elsewhere — from the owner toolbar, on another
    // device, or by the retention job — so deleted albums sat in this list forever, and tapping
    // Delete on one did nothing because it was already gone. Ask the server which are still real
    // and drop the rest. On any failure the list is left exactly as it was: pruning on a network
    // error would throw away the owner's only copy of a live album's management token.
    if (local.length === 0) return
    let cancelled = false
    void fetch('/api/album/exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs: local.map((a) => a.slug) }),
    })
      .then((r) => (r.ok ? r.json() as Promise<{ alive?: string[]; unclaimed?: string[]; binned?: string[] }> : null))
      .then((res) => {
        if (cancelled || !res || !Array.isArray(res.alive)) return
        if (Array.isArray(res.unclaimed)) setUnclaimed(new Set(res.unclaimed))
        // A BINNED ALBUM IS NOT DEAD. It is hidden and recoverable, so it must survive the prune —
        // forgetting it here would throw away the owner token within seconds of the owner deleting
        // the album, and that token is the only thing the restore route can authenticate with.
        const inBin = new Set(Array.isArray(res.binned) ? res.binned : [])
        setBinned(inBin)
        const alive = new Set(res.alive)
        const dead = local.filter((a) => !alive.has(a.slug) && !inBin.has(a.slug))
        if (dead.length === 0) return
        for (const a of dead) forgetAlbum(a.slug)
        setAlbums(getMyAlbums())
      })
      .catch(() => { /* leave the list untouched */ })
    return () => { cancelled = true }
  }, [])

  // Attach an album made while signed out to the account the visitor is signed into now.
  //
  // Two calls, the same shape deleteAlbum uses: owner-login proves ownership with the token this
  // device remembers and sets the owner cookie; claim then reports what happened. The attach
  // itself is a side effect of owner-login (see claimAlbumIfNeeded) — claim never writes, it only
  // tells us the truth about the result, including "your plan is full", which no surface used to
  // say out loud.
  async function claimAlbum(a: MyAlbum) {
    if (busy) return
    setBusy(a.slug)
    try {
      const login = await fetch('/api/album/owner-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: a.slug, owner_token: a.token }),
      })
      if (!login.ok) { showAppToast(t('common.errorGeneric'), 'error'); return }

      const res = await fetch('/api/album/claim', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: a.slug }),
      })
      const body = await res.json().catch(() => ({})) as { ok?: boolean; reason?: string; cap?: number }

      if (body.ok) {
        // It is on the account now, so it belongs on the account page rather than in this list.
        setUnclaimed((prev) => {
          if (!prev) return prev
          const next = new Set(prev)
          next.delete(a.slug)
          return next
        })
        showAppToast(t('claim.done'), 'success')
      } else if (body.reason === 'at_cap') {
        // The one refusal worth explaining: nothing they do on this screen will change it, so
        // "try again" would be a lie.
        showAppToast(t('claim.atCap').replace('{cap}', String(body.cap ?? '')), 'error')
      } else {
        showAppToast(t('claim.failed'), 'error')
      }
    } catch {
      showAppToast(t('common.networkError'), 'error')
    } finally {
      setBusy(null)
    }
  }

  // Deleting for real (not just forgetting): for an anonymous album, dropping it from this device
  // means losing its management token anyway, so we delete the album — which also frees a slot in the
  // per-device album cap. We authenticate with the remembered owner_token first (sets the owner
  // cookie the delete route checks), then delete, then drop it from the local list.
  // Put a deleted album back. Same two steps as deleting: prove ownership with the remembered
  // token (which sets the owner cookie), then act.
  async function restoreAlbum(a: MyAlbum) {
    if (busy) return
    setBusy(a.slug)
    try {
      const login = await fetch('/api/album/owner-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: a.slug, owner_token: a.token }),
      })
      if (!login.ok) {
        showAppToast(t('common.errorGeneric'), 'error')
        return
      }
      const res = await fetch('/api/album/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: a.slug }),
      })
      if (!res.ok) {
        showAppToast(t('common.errorGeneric'), 'error')
        return
      }
      showAppToast(t('ot.albumRestored'))
      setBinned((prev) => {
        const next = new Set(prev)
        next.delete(a.slug)
        return next
      })
    } catch {
      showAppToast(t('common.networkError'), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function deleteAlbum(a: MyAlbum) {
    if (busy) return
    if (!window.confirm(t('myAlbums.removeConfirm'))) return
    setBusy(a.slug)
    try {
      const login = await fetch('/api/album/owner-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: a.slug, owner_token: a.token }),
      })
      // "Deleted" = the album is confirmed gone. 404 anywhere means it's already gone (also success).
      // We only drop it from this device once that's true, so a transient auth/network failure never
      // silently orphans the album (forgetting the token without deleting the album).
      let deleted = login.status === 404
      if (login.ok) {
        const del = await fetch('/api/album/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: a.slug }),
        })
        deleted = del.ok || del.status === 404
        if (!deleted) {
          const body = await del.json().catch(() => ({})) as { error?: string }
          showAppToast(body.error ?? t('common.errorGeneric'), 'error')
        }
      } else if (!deleted) {
        showAppToast(t('common.errorGeneric'), 'error')
      }
      if (deleted) {
        forgetAlbum(a.slug)
        setAlbums(getMyAlbums())
      }
    } catch {
      showAppToast(t('common.networkError'), 'error')
    } finally {
      setBusy(null)
    }
  }

  // Wait for both answers before rendering anything. A signed-in visitor must never be shown a
  // list captioned "not on your account" before we know which albums that is true of.
  if (loggedIn === null) return null
  if (!albums || albums.length === 0) return null

  // Signed out: every remembered album, unchanged. Signed in: only the ones with no account
  // behind them — the rest are already on their account page, and repeating them here would be
  // two lists of the same thing that can disagree.
  const liveAlbums = albums.filter((a) => !binned.has(a.slug))
  const rows = loggedIn ? liveAlbums.filter((a) => unclaimed?.has(a.slug)) : liveAlbums
  // Deleted albums are listed for EVERYONE here, signed in or not: an album made while signed out
  // never reaches the account page, so for those owners this is the only door back.
  const binnedRows = albums.filter((a) => binned.has(a.slug))
  if (rows.length === 0 && binnedRows.length === 0) return null

  return (
    <section className="hush-container pb-10" aria-label="Your albums on this device">
      <div
        className="rounded-2xl px-5 py-4 sm:px-6 sm:py-5"
        style={{ background: '#FFFFFF', border: '1px solid #E4DAC9', boxShadow: '0 4px 20px rgba(99,8,38,0.05)' }}
      >
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm sm:text-base" style={{ fontWeight: 700, color: '#630826', fontFamily: 'var(--font-serif)' }}>
            {loggedIn ? t('claim.title') : t('myAlbums.title')}
          </h2>
          <span className="text-xs" style={{ color: '#8A7A66' }}>{t('myAlbums.saved', { n: rows.length })}</span>
        </div>
        <p className="text-xs mb-3" style={{ color: '#8A7A66' }}>
          {loggedIn ? t('claim.body') : t('myAlbums.subtitle')}
        </p>
        <ul className="flex flex-col divide-y" style={{ borderColor: '#EFE7D8' }}>
          {rows.map((a) => (
            <li key={a.slug} className="flex items-center justify-between gap-3 py-2">
              <a
                href={`/${a.slug}#owner=${a.token}`}
                className="flex-1 min-w-0 truncate text-sm hover:underline"
                style={{ color: '#2A211C', fontWeight: 600 }}
              >
                {a.title}
              </a>
              <div className="flex items-center gap-3 shrink-0">
                {loggedIn ? (
                  <button
                    type="button"
                    onClick={() => void claimAlbum(a)}
                    disabled={!!busy}
                    className="text-xs disabled:opacity-50"
                    style={{ color: '#630826', fontWeight: 700 }}
                  >
                    {busy === a.slug ? t('claim.working') : t('claim.cta')}
                  </button>
                ) : (
                  <a href={`/${a.slug}#owner=${a.token}`} className="text-xs" style={{ color: '#630826', fontWeight: 600 }}>
                    {t('myAlbums.manage')}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => void deleteAlbum(a)}
                  disabled={!!busy}
                  className="text-xs disabled:opacity-50"
                  style={{ color: '#B23A48' }}
                  aria-label={`${t('myAlbums.remove')} ${a.title}`}
                >
                  {busy === a.slug ? t('myAlbums.removing') : t('myAlbums.remove')}
                </button>
              </div>
            </li>
          ))}
        </ul>

        {binnedRows.length > 0 && (
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid #EFE7D8' }}>
            <h3 className="text-xs mb-1" style={{ fontWeight: 700, color: '#630826' }}>
              {t('acct.recentlyDeleted')}
            </h3>
            <p className="text-xs mb-2" style={{ color: '#8A7A66' }}>{t('acct.recentlyDeletedDesc')}</p>
            <ul className="flex flex-col divide-y" style={{ borderColor: '#EFE7D8' }}>
              {binnedRows.map((a) => (
                <li key={a.slug} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex-1 min-w-0 truncate text-sm" style={{ color: '#8A7A66', fontWeight: 600 }}>
                    {a.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => void restoreAlbum(a)}
                    disabled={!!busy}
                    className="text-xs shrink-0 disabled:opacity-50"
                    style={{ color: '#630826', fontWeight: 700 }}
                  >
                    {busy === a.slug ? t('ot.restoring') : t('ot.undoDelete')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
