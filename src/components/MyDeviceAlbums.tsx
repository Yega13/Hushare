'use client'

import { useEffect, useState } from 'react'
import { getMyAlbums, forgetAlbum, type MyAlbum } from '@/lib/my-albums'
import { createClient } from '@/lib/supabase/client'
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

  useEffect(() => {
    setAlbums(getMyAlbums())
    createClient().auth.getSession().then(({ data }) => setLoggedIn(!!data.session)).catch(() => setLoggedIn(false))
  }, [])

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
                  onClick={() => { forgetAlbum(a.slug); setAlbums(getMyAlbums()) }}
                  className="text-xs"
                  style={{ color: '#8A7A66' }}
                  aria-label={`${t('myAlbums.remove')} ${a.title}`}
                >
                  {t('myAlbums.remove')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
