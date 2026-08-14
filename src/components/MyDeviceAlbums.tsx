'use client'

import { useEffect, useState } from 'react'
import { getMyAlbums, forgetAlbum, type MyAlbum } from '@/lib/my-albums'
import { createClient } from '@/lib/supabase/client'
import { showAppToast } from '@/components/AppToast'
import { useT } from '@/i18n/LocaleProvider'

// "Your albums on this device" — recovery for ANONYMOUS creators only. Reads localStorage
// (client-only), so it renders nothing on the server and nothing until we've checked. Registered
// users manage their albums from their account, so this list is hidden for them. Each entry links
// back to the album's owner (#owner=) view, so an anon creator who closed the tab never loses it.
export default function MyDeviceAlbums() {
  const { t } = useT()
  const [albums, setAlbums] = useState<MyAlbum[] | null>(null)
  // null = still checking; false = signed out (show); true = signed in (hide).
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

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
      .then((r) => (r.ok ? r.json() as Promise<{ alive?: string[] }> : null))
      .then((res) => {
        if (cancelled || !res || !Array.isArray(res.alive)) return
        const alive = new Set(res.alive)
        const dead = local.filter((a) => !alive.has(a.slug))
        if (dead.length === 0) return
        for (const a of dead) forgetAlbum(a.slug)
        setAlbums(getMyAlbums())
      })
      .catch(() => { /* leave the list untouched */ })
    return () => { cancelled = true }
  }, [])

  // Deleting for real (not just forgetting): for an anonymous album, dropping it from this device
  // means losing its management token anyway, so we delete the album — which also frees a slot in the
  // per-device album cap. We authenticate with the remembered owner_token first (sets the owner
  // cookie the delete route checks), then delete, then drop it from the local list.
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

  // Only show once we've confirmed the visitor is signed OUT — never flash it to a signed-in user.
  if (loggedIn !== false) return null
  if (!albums || albums.length === 0) return null

  return (
    <section className="hush-container pb-10" aria-label="Your albums on this device">
      <div
        className="rounded-2xl px-5 py-4 sm:px-6 sm:py-5"
        style={{ background: '#FFFFFF', border: '1px solid #E4DAC9', boxShadow: '0 4px 20px rgba(99,8,38,0.05)' }}
      >
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm sm:text-base" style={{ fontWeight: 700, color: '#630826', fontFamily: 'var(--font-serif)' }}>
            {t('myAlbums.title')}
          </h2>
          <span className="text-xs" style={{ color: '#8A7A66' }}>{t('myAlbums.saved', { n: albums.length })}</span>
        </div>
        <p className="text-xs mb-3" style={{ color: '#8A7A66' }}>
          {t('myAlbums.subtitle')}
        </p>
        <ul className="flex flex-col divide-y" style={{ borderColor: '#EFE7D8' }}>
          {albums.map((a) => (
            <li key={a.slug} className="flex items-center justify-between gap-3 py-2">
              <a
                href={`/${a.slug}#owner=${a.token}`}
                className="flex-1 min-w-0 truncate text-sm hover:underline"
                style={{ color: '#2A211C', fontWeight: 600 }}
              >
                {a.title}
              </a>
              <div className="flex items-center gap-3 shrink-0">
                <a href={`/${a.slug}#owner=${a.token}`} className="text-xs" style={{ color: '#630826', fontWeight: 600 }}>
                  {t('myAlbums.manage')}
                </a>
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
      </div>
    </section>
  )
}
